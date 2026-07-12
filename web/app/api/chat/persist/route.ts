export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import * as Sentry from '@sentry/nextjs';

/**
 * Server-to-server persistence for the edge chat stream. The Cloudflare Worker calls
 * this (from waitUntil, after /chat-stream finishes) with the assistant reply and an
 * HMAC content signature. We verify the signature (proves it came from the worker, not
 * a forged caller), confirm the conversation belongs to the claimed user, then insert
 * the assistant turn with the service role — keeping Postgres the durable source of
 * truth while the tokens themselves streamed browser<->worker.
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const payloadSchema = z.object({
      conversationId: z.string(),
      userId: z.string(),
      content: z.string(),
      contentSig: z.string(),
      // Expiry for the bound content signature (see verifyContentSig). Optional
      // for backward compat with a worker that hasn't shipped the bound signer yet.
      exp: z.number().int().optional(),
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { conversationId, userId, content, contentSig, exp } = parsed.data;

    // Tamper check: the worker signed the exact reply text with the shared secret,
    // bound to this conversation + an expiry so it can't be replayed or reused.
    let isSigValid = false;
    try {
      isSigValid = await verifyContentSig(content, contentSig, exp !== undefined ? { purpose: 'chat-persist', id: conversationId, exp } : undefined);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Sentry.captureException(error, { contexts: { persist: { phase: 'chat-verifyContentSig', conversationId } } });
      console.error('[chat/persist]', { message: msg, conversationId });
      return NextResponse.json({ error: 'Security configuration error' }, { status: 500 });
    }

    if (!isSigValid) {
      console.warn('[chat/persist] Invalid content signature', { conversationId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    // Ownership: the conversation must belong to the user the token was bound to.
    const conv = await persistenceAdapter.getConversation({ conversationId });
    if (!conv || conv.userId !== userId) {
      console.warn('[chat/persist] Conversation/owner mismatch or not found', { conversationId });
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch conversation messages to associate this assistant reply with the corresponding user message.
    const messages = await persistenceAdapter.getMessages({ conversationId });
    const userMessages = messages.filter((m) => m.role === 'user');
    const latestUserMessage = userMessages.length > 0
      ? userMessages.reduce((latest, current) =>
          new Date(current.createdAt).getTime() > new Date(latest.createdAt).getTime() ? current : latest
        )
      : undefined;

    // Turn-scoped idempotency (ADR 146): check if this assistant message already exists
    // for this specific user turn (parent message). This prevents suppressing valid repeated
    // assistant replies on later turns and eliminates race conditions under concurrent retries.
    if (latestUserMessage) {
      const existingReply = await persistenceAdapter.findAssistantByParentId({
        conversationId,
        parentId: latestUserMessage.id,
      });
      if (existingReply) {
        // Assistant reply already exists for this turn; return success to allow retry idempotency
        return NextResponse.json({ ok: true, message: existingReply, idempotent: true });
      }
    }

    // Attempt to create the assistant message with turn-scoped idempotency.
    // If concurrent request already created it for this parent_message_id, the unique
    // constraint violation is caught and handled gracefully.
    try {
      const aRow = await persistenceAdapter.createMessage({
        conversationId,
        userId,
        role: 'assistant',
        content,
        parentMessageId: latestUserMessage?.id || null,
      });

      return NextResponse.json({ ok: true, message: aRow });
    } catch (createError: unknown) {
      // Handle unique constraint violation (concurrent retry created the message).
      // Re-fetch and return the existing message for idempotency.
      const errorCode = (createError as { code?: string })?.code;
      if (errorCode === '23505') {
        if (latestUserMessage) {
          const existingReply = await persistenceAdapter.findAssistantByParentId({
            conversationId,
            parentId: latestUserMessage.id,
          });
          if (existingReply) {
            console.info('[chat/persist] Idempotent retry detected (concurrent create)', {
              conversationId,
              parentMessageId: latestUserMessage.id,
            });
            return NextResponse.json({ ok: true, message: existingReply, idempotent: true });
          }
        }
      }

      // Not a constraint violation or re-fetch failed; bubble up the error
      throw createError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'chat-persist' }, contexts: { api: { endpoint: '/api/chat/persist' } } });
    console.error('[chat/persist] Failed:', message);
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
  }
}
