export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { ChatMessage, ChatRole } from '@/lib/types/chat';
import { signChatToken } from '@/lib/stream-token';
import { getUserTier } from '@/lib/services/traffic';
import { resolveModelCascade } from '@/lib/services/settings';

type Row = {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  client_msg_id?: string | null;
};

const toMsg = (r: Row): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
  clientMsgId: r.client_msg_id ?? null,
});

const COLS = 'id, conversation_id, role, content, created_at, client_msg_id';
const HISTORY_TURNS = 20;

/* GET — load a thread's messages (RLS scopes to owner). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select(COLS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chat] load messages failed:', error.message);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
  return NextResponse.json({ messages: (data as Row[]).map(toMsg) });
}

/*
 * POST — append a user message (idempotent on client_msg_id) and STREAM the assistant
 * reply via SSE. Events: user | title | delta | done | error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId : null;
  if (!content) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }

  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('id, title, analysis_id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // --- Idempotent user-message write ---------------------------------------
  let userRow: Row | null = null;
  let isRetry = false;

  if (clientMsgId) {
    const { data: existing } = await supabase
      .from('chat_messages')
      .select(COLS)
      .eq('conversation_id', id)
      .eq('client_msg_id', clientMsgId)
      .maybeSingle();
    if (existing) {
      userRow = existing as Row;
      isRetry = true;
    }
  }
  if (!userRow) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: id,
        user_id: user.id,
        role: 'user',
        content: content,
        client_msg_id: clientMsgId,
      })
      .select(COLS)
      .single();
    if (error) {
      // 23505 = unique violation: a concurrent retry won the race; fetch theirs.
      if (error.code === '23505' && clientMsgId) {
        const { data: raced } = await supabase
          .from('chat_messages')
          .select(COLS)
          .eq('conversation_id', id)
          .eq('client_msg_id', clientMsgId)
          .single();
        userRow = raced as Row;
        isRetry = true;
      } else {
        console.error('[chat] user message insert failed:', error.message);
        return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
      }
    } else {
      userRow = data as Row;
    }
  }

  // If this is a retry that already produced an assistant reply, return it (no regen).
  if (isRetry) {
    const { data: laterAssistant } = await supabase
      .from('chat_messages')
      .select(COLS)
      .eq('conversation_id', id)
      .eq('role', 'assistant')
      .gt('created_at', userRow.created_at)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (laterAssistant) {
      // Already answered on a prior attempt — return both turns, no regeneration.
      return NextResponse.json({
        user: toMsg(userRow!),
        assistant: toMsg(laterAssistant as Row),
      });
    }
  }

  // Auto-title from the first user message.
  let newTitle: string | undefined;
  if (conv.title === 'New chat') {
    newTitle = content.slice(0, 60);
    await supabase
      .from('chat_conversations')
      .update({ title: newTitle })
      .eq('id', id);
  }

  // Replay bounded history (model is stateless).
  const { data: histRows } = await supabase
    .from('chat_messages')
    .select(COLS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  const history = ((histRows as Row[]) || []).reverse();

  // Grounding from the linked analysis. If the markdown is ready, ground fully; if the
  // analysis is still streaming (row exists but markdown empty), still tell the model
  // which video it is + that the analysis is in progress — so it never asks "what video?"
  // and can answer from the title/metadata instead of giving a clueless generic reply.
  let grounding = '';
  if (conv.analysis_id) {
    const { data: a } = await supabase
      .from('analyses')
      .select('title, channel_title, analysis_markdown, validation_report')
      .eq('id', conv.analysis_id)
      .maybeSingle();
    if (a) {
      const md = typeof a.analysis_markdown === 'string' ? a.analysis_markdown : '';
      const status = (a.validation_report as any)?.status;
      if (md.trim().length > 0) {
        grounding =
          `You are the analyst for the YouTube video "${a.title ?? ''}"${a.channel_title ? ` by ${a.channel_title}` : ''}. ` +
          `Answer the user's questions using the structured analysis below; be concise and cite dimension names where relevant. ` +
          `Do not ask which video — you have it.\n\n--- ANALYSIS ---\n` +
          md.slice(0, 12000);
      } else {
        grounding =
          `You are the analyst for the YouTube video "${a.title ?? ''}"${a.channel_title ? ` by ${a.channel_title}` : ''}. ` +
          `The full ${status === 'processing' ? 'analysis is still being generated' : 'analysis is not available yet'} — answer from the title/topic ` +
          `and let the user know richer answers will be available once the synthesis finishes. Never claim you don't know which video this is.`;
      }
    }
  }

// Bouncer: mint an HMAC token and hand the browser everything it needs to stream the
  // reply directly from the worker (/chat-stream). The LLM tokens never traverse this
  // Vercel function; the worker persists the assistant turn S2S via /api/chat/persist.
  // Resolve the per-tier chat cascade (app_settings; falls back to hardcoded) and bind
  // it into the token so the worker runs exactly this list and it can't be escalated.
  const tier = (await getUserTier(user.id)) ?? 'free';
  const chatModels = await resolveModelCascade(tier, 'chat');
  const { sig, exp } = signChatToken(id, user.id, chatModels);
  return NextResponse.json({
    user: toMsg(userRow),
    ...(newTitle ? { title: newTitle } : {}),
    stream: {
      url: `${process.env.NEXT_PUBLIC_WORKER_URL || ''}/chat-stream`,
      sig,
      exp,
    },
    payload: {
      conversationId: id,
      userId: user.id,
      grounding,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      models: chatModels,
    },
  });
}