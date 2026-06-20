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
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { conversationId, userId, content, contentSig } = parsed.data;

    // Tamper check: the worker signed the exact reply text with the shared secret.
    let isSigValid = false;
    try {
      isSigValid = await verifyContentSig(content, contentSig);
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

    const aRow = await persistenceAdapter.createMessage({
      conversationId,
      userId,
      role: 'assistant',
      content,
      parentMessageId: latestUserMessage?.id || null,
    });

    return NextResponse.json({ ok: true, message: aRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'chat-persist' }, contexts: { api: { endpoint: '/api/chat/persist' } } });
    console.error('[chat/persist] Failed:', message);
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
  }
}
