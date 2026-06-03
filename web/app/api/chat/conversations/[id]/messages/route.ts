export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { ChatMessage, ChatRole } from '@/lib/types/chat';

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

/** GET — load a thread's messages (RLS scopes to owner). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

/**
 * POST — append a user message (idempotent on client_msg_id) and STREAM the assistant
 * reply via SSE. Events: user | title | delta | done | error.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId : null;
  if (!content) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('id, title, analysis_id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  // --- Idempotent user-message write ---------------------------------------
  let userRow: Row | null = null;
  let isRetry = false;

  if (clientMsgId) {
    const { data: existing } = await supabase.from('chat_messages').select(COLS).eq('conversation_id', id).eq('client_msg_id', clientMsgId).maybeSingle();
    if (existing) {
      userRow = existing as Row;
      isRetry = true;
    }
  }
  if (!userRow) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: id, user_id: user.id, role: 'user', content, client_msg_id: clientMsgId })
      .select(COLS)
      .single();
    if (error) {
      // 23505 = unique violation: a concurrent retry won the race; fetch theirs.
      if (error.code === '23505' && clientMsgId) {
        const { data: raced } = await supabase.from('chat_messages').select(COLS).eq('conversation_id', id).eq('client_msg_id', clientMsgId).single();
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
      return sse((send) => {
        send({ type: 'user', message: toMsg(userRow!) });
        send({ type: 'done', message: toMsg(laterAssistant as Row) });
      });
    }
  }

  // Auto-title from the first user message.
  let newTitle: string | undefined;
  if (conv.title === 'New chat') {
    newTitle = content.slice(0, 60);
    await supabase.from('chat_conversations').update({ title: newTitle }).eq('id', id);
  }

  // Replay bounded history (model is stateless).
  const { data: histRows } = await supabase
    .from('chat_messages')
    .select(COLS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  const history = ((histRows as Row[]) || []).reverse();

  // Optional grounding from the linked analysis.
  let grounding = '';
  if (conv.analysis_id) {
    const { data: a } = await supabase.from('analyses').select('title, analysis_markdown').eq('id', conv.analysis_id).maybeSingle();
    if (a?.analysis_markdown) {
      grounding =
        `You are grounded in this YouTube analysis titled "${a.title ?? ''}". ` +
        `Answer using its content; be concise and cite dimension names where relevant.\n\n` +
        String(a.analysis_markdown).slice(0, 12000);
    }
  }

  const userMsg = toMsg(userRow);
  const apiKey = process.env.OPENROUTER_API_KEY;

  return sse(async (send) => {
    send({ type: 'user', message: userMsg });
    if (newTitle) send({ type: 'title', title: newTitle });

    let full = '';
    try {
      if (!apiKey) {
        full =
          "I'm saving this thread to your history, but no model key is configured here yet. " +
          'Once a model key is set on the server, replies stream in live, grounded in the linked analysis.';
        send({ type: 'delta', content: full });
      } else {
        full = await streamOpenRouter(apiKey, grounding, history, (chunk) => send({ type: 'delta', content: chunk }));
        if (!full) full = 'No response generated.';
      }
    } catch {
      full = 'The model request failed. Your message is saved — please try again.';
      send({ type: 'delta', content: full });
    }

    const { data: aRow } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: id, user_id: user.id, role: 'assistant', content: full })
      .select(COLS)
      .single();
    if (aRow) send({ type: 'done', message: toMsg(aRow as Row) });
    else send({ type: 'error', error: 'Failed to persist reply' });
  });
}

// --- SSE helpers -----------------------------------------------------------

function sse(producer: (send: (obj: unknown) => void) => void | Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      try {
        await producer(send);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

// Chat is fast grounded Q&A, NOT deep analysis — favor a snappy, high-TPS, free model
// with no heavy reasoning. Gemini 2.0 Flash leads (fast, huge context, implicit prompt
// caching on the resent grounding). Nemotron is the resilient fallback, capped to LOW
// reasoning effort so it stays responsive. (Reasoning param is ignored by models that
// don't support it.) Requires the Google provider enabled in the OpenRouter allowlist.
const CHAT_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
] as const;

async function streamOpenRouter(
  apiKey: string,
  grounding: string,
  history: Row[],
  onDelta: (chunk: string) => void
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (grounding) messages.push({ role: 'system', content: grounding });
  for (const m of history) messages.push({ role: m.role, content: m.content });

  // Try models in order; commit to the first that produces tokens.
  for (const model of CHAT_MODELS) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 50000);
    let full = '';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://yt-intel.getmytestdrive.com' },
        body: JSON.stringify({
          model,
          temperature: 0.6,
          max_tokens: 1200,
          stream: true,
          reasoning: { effort: 'low' },
          messages,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) continue; // try next model
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            /* keep-alive / partial */
          }
        }
      }
      if (full) return full; // committed to this model
    } catch {
      /* timeout / network — fall through to next model */
    } finally {
      clearTimeout(t);
    }
  }
  return '';
}
