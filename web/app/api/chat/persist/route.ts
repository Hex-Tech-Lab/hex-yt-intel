export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import * as Sentry from '@sentry/nextjs';
import { ERROR_PHASES } from '@/lib/error-codes';
import { categorizeError } from '@/lib/services/error-handler';

/**
 * Server-to-server persistence for the edge chat stream. The Cloudflare Worker calls
 * this (from waitUntil, after /chat-stream finishes) with the assistant reply and an
 * HMAC content signature. We verify the signature (proves it came from the worker, not
 * a forged caller), confirm the conversation belongs to the claimed user, then insert
 * the assistant turn with the service role — keeping Postgres the durable source of
 * truth while the tokens themselves streamed browser<->worker.
 *
 * Network Resilience:
 * - Signature verification failures trigger graceful degradation (log warning, continue if from trusted source)
 * - Database timeouts are retryable with exponential backoff
 * - Request validation failures fail-fast (no retry)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.REQUEST_VALIDATION);
      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'json_parse', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/chat/persist' } }
      });
      console.error('[chat/persist] JSON parse error', { requestId, message: err.message });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const payloadSchema = z.object({
      conversationId: z.string(),
      userId: z.string(),
      content: z.string(),
      contentSig: z.string(),
      exp: z.number().int().optional(),
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      const err = categorizeError(parsed.error, ERROR_PHASES.REQUEST_VALIDATION);
      console.warn('[chat/persist] Invalid payload schema', { requestId, issues: parsed.error.issues.length });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const { conversationId, userId, content, contentSig, exp } = parsed.data;

    // Strict tamper check: signature verification is non-negotiable. No fallback based on
    // request headers (x-forwarded-for is spoofable). Timeout is retryable, other failures
    // indicate a real security issue or environment misconfiguration.
    let isSigValid = false;
    try {
      isSigValid = await Promise.race([
        verifyContentSig(content, contentSig, exp !== undefined ? { purpose: 'chat-persist', id: conversationId, exp } : undefined),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Signature verification timeout')), 5000))
      ]);
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.SIGNATURE_VERIFICATION);
      const isTimeout = (error instanceof Error) && (error.message.includes('timeout') || error.message.includes('AbortError'));

      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'signature_verify', retryable: String(isTimeout), isTimeout: String(isTimeout) },
        level: isTimeout ? 'warning' : 'error',
        contexts: { persist: { phase: 'chat-verifyContentSig', conversationId, requestId, isTimeout } }
      });

      if (isTimeout) {
        // Timeout during verification is retryable; worker will retry
        console.warn('[chat/persist] Signature verification timeout (retryable)', { requestId, conversationId });
        return NextResponse.json({ error: 'Signature verification timeout' }, { status: 503 });
      }

      // Non-timeout signature verification failure: fail closed (no fallback)
      console.error('[chat/persist] Signature verification failed (non-timeout)', { requestId, conversationId, error: err.message });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    if (!isSigValid) {
      console.error('[chat/persist] Signature verification returned false', { requestId, conversationId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    // Ownership: the conversation must belong to the user the token was bound to.
    let conv;
    try {
      conv = await persistenceAdapter.getConversation({ conversationId });
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.DATABASE_FETCH);
      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'ownership_fetch', retryable: String(err.retryable) },
        contexts: { api: { requestId, conversationId, endpoint: '/api/chat/persist' } }
      });
      console.error('[chat/persist] Database fetch failed during ownership check', { requestId, conversationId, error: err.message, retryable: err.retryable });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    if (!conv || conv.userId !== userId) {
      console.warn('[chat/persist] Conversation/owner mismatch or not found', { requestId, conversationId, userId });
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Idempotency: check if this exact assistant message already exists in this conversation.
    let messages;
    try {
      messages = await persistenceAdapter.getMessages({ conversationId });
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.DATABASE_FETCH);
      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'idempotency_check', retryable: String(err.retryable) },
        contexts: { api: { requestId, conversationId } }
      });
      console.error('[chat/persist] Database fetch failed during idempotency check', { requestId, conversationId, error: err.message });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const existingReply = assistantMessages.find((m) => m.content === content);
    if (existingReply) {
      console.info('[chat/persist] Message already persisted (idempotent return)', { requestId, conversationId, messageId: existingReply.id });
      return NextResponse.json({ ok: true, message: existingReply, idempotent: true });
    }

    // Find the latest user message to associate this assistant reply with.
    const userMessages = messages.filter((m) => m.role === 'user');
    const latestUserMessage = userMessages.length > 0
      ? userMessages.reduce((latest, current) =>
          new Date(current.createdAt).getTime() > new Date(latest.createdAt).getTime() ? current : latest
        )
      : undefined;

    let aRow;
    try {
      aRow = await persistenceAdapter.createMessage({
        conversationId,
        userId,
        role: 'assistant',
        content,
        parentMessageId: latestUserMessage?.id || null,
      });
    } catch (error) {
      const err = categorizeError(error, ERROR_PHASES.DATABASE_WRITE);
      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'message_create', retryable: String(err.retryable) },
        contexts: { api: { requestId, conversationId, userId } }
      });
      console.error('[chat/persist] Database write failed', { requestId, conversationId, error: err.message, retryable: err.retryable });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const duration = Date.now() - startTime;
    console.info('[chat/persist] Message persisted successfully', { requestId, conversationId, messageId: aRow.id, duration });
    return NextResponse.json({ ok: true, message: aRow });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'chat-persist', phase: 'unknown' },
      contexts: { api: { requestId, endpoint: '/api/chat/persist', duration } }
    });
    console.error('[chat/persist] Unexpected error', { requestId, message, duration });
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
  }
}
