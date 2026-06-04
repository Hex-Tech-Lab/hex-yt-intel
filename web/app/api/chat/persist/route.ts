export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyContentSig } from '@/lib/stream-token';
import { env } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';

/**
 * Server-to-server persistence for the edge chat stream. The Cloudflare Worker calls
 * this (from waitUntil, after /chat-stream finishes) with the assistant reply and an
 * HMAC content signature. We verify the signature (proves it came from the worker, not
 * a forged caller), confirm the conversation belongs to the claimed user, then insert
 * the assistant turn with the service role — keeping Postgres the durable source of
 * truth while the tokens themselves streamed browser<->worker.
 *
 * Uses the raw supabase-js client (service role) because the SSR wrapper expects
 * cookies for a session, which don't exist on an S2S call.
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

    const service = createClient(env.supabaseUrl, env.supabaseServiceRoleKey!);

    // Ownership: the conversation must belong to the user the token was bound to.
    const { data: conv, error: convError } = await service
      .from('chat_conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convError) {
      Sentry.captureException(convError, { tags: { operation: 'chat-persist', reason: 'conv-fetch' } });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!conv || conv.user_id !== userId) {
      console.warn('[chat/persist] Conversation/owner mismatch', { conversationId });
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const { data: aRow, error: insertError } = await service
      .from('chat_messages')
      .insert({ conversation_id: conversationId, user_id: userId, role: 'assistant', content })
      .select('id, conversation_id, role, content, created_at, client_msg_id')
      .single();

    if (insertError || !aRow) {
      Sentry.captureException(insertError ?? new Error('insert returned no row'), { tags: { operation: 'chat-persist' } });
      return NextResponse.json({ error: 'Failed to persist reply' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: aRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'chat-persist' }, contexts: { api: { endpoint: '/api/chat/persist' } } });
    console.error('[chat/persist] Failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
