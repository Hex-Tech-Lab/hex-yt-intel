export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import * as Sentry from '@sentry/nextjs';

/**
 * Error categorization for network resilience and observability.
 */
type ErrorCategory =
  | 'signature_verification'
  | 'ownership_check'
  | 'database_fetch'
  | 'database_write'
  | 'network_timeout'
  | 'request_validation'
  | 'unknown';

interface PersistError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
}

/**
 * Categorize database and network errors for proper retry logic and observability.
 */
function categorizePersistError(error: unknown, phase: string): PersistError {
  const message = error instanceof Error ? error.message : String(error);

  if (phase === 'request_validation') {
    return { category: 'request_validation', code: 'INVALID_REQUEST', message, retryable: false, statusCode: 400 };
  }
  if (phase === 'signature_verification') {
    return { category: 'signature_verification', code: 'INVALID_SIGNATURE', message, retryable: true, statusCode: 401 };
  }
  if (phase === 'ownership_check') {
    return { category: 'ownership_check', code: 'UNAUTHORIZED', message, retryable: false, statusCode: 404 };
  }
  if (phase === 'database_fetch' || phase === 'idempotency_check') {
    // Network timeouts during fetch are retryable, other DB errors are not
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET') || message.includes('ETIMEDOUT');
    return { category: 'database_fetch', code: 'DB_FETCH_ERROR', message, retryable: isTimeout, statusCode: isTimeout ? 503 : 500 };
  }
  if (phase === 'database_write') {
    // Constraint violations are not retryable; transient errors are
    const isTransient = message.includes('timeout') || message.includes('connection') || message.includes('ECONNRESET');
    return { category: 'database_write', code: 'DB_WRITE_ERROR', message, retryable: isTransient, statusCode: isTransient ? 503 : 500 };
  }
  return { category: 'unknown', code: 'INTERNAL_ERROR', message, retryable: true, statusCode: 500 };
}

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
      const err = categorizePersistError(error, 'request_validation');
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
      const err = categorizePersistError(parsed.error, 'request_validation');
      console.warn('[chat/persist] Invalid payload schema', { requestId, issues: parsed.error.issues.length });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const { conversationId, userId, content, contentSig, exp } = parsed.data;

    // Tamper check with graceful degradation: signature verification failures log but allow continuation
    // if from trusted worker IP (configured in environment)
    let isSigValid = false;
    try {
      isSigValid = await Promise.race([
        verifyContentSig(content, contentSig, exp !== undefined ? { purpose: 'chat-persist', id: conversationId, exp } : undefined),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Signature verification timeout')), 5000))
      ]);
    } catch (error) {
      const err = categorizePersistError(error, 'signature_verification');

      // Log signature verification failure but allow fallback if from trusted source
      Sentry.captureException(error, {
        tags: { operation: 'chat-persist', phase: 'signature_verify', retryable: String(err.retryable) },
        level: 'warning',
        contexts: { persist: { phase: 'chat-verifyContentSig', conversationId, requestId } }
      });
      console.warn('[chat/persist] Signature verification failed (may retry)', { requestId, conversationId, error: err.message });

      // Check if caller is from trusted worker IP (future: implement IP whitelist)
      const callerIP = request.headers.get('x-forwarded-for') || 'unknown';
      if (process.env.CHAT_WORKER_IP && callerIP === process.env.CHAT_WORKER_IP) {
        console.info('[chat/persist] Trusting caller IP, proceeding without verification', { requestId, callerIP });
        isSigValid = true; // Fallback: trust the caller
      }
    }

    if (!isSigValid) {
      console.warn('[chat/persist] Untrusted caller: signature invalid', { requestId, conversationId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    // Ownership: the conversation must belong to the user the token was bound to.
    let conv;
    try {
      conv = await persistenceAdapter.getConversation({ conversationId });
    } catch (error) {
      const err = categorizePersistError(error, 'database_fetch');
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
      const err = categorizePersistError(error, 'database_fetch');
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
      const err = categorizePersistError(error, 'database_write');
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
