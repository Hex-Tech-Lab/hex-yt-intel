export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
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
  let body: { conversationId?: string; userId?: string; content?: string; contentSig?: string } | undefined;
  try {
    body = await request.json();
    const { conversationId, userId, content, contentSig } = body || {};

    if (!conversationId || !userId || typeof content !== 'string' || !contentSig) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Tamper check: the worker signed the exact reply text with the shared secret.
    if (!verifyContentSig(content, contentSig)) {
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

    const aRow = await persistenceAdapter.createMessage({
      conversationId,
      userId,
      role: 'assistant',
      content,
    });

    return NextResponse.json({ ok: true, message: aRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'chat-persist' }, contexts: { api: { endpoint: '/api/chat/persist' } } });
    console.error('[chat/persist] Failed:', message);
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 });
  }
}
