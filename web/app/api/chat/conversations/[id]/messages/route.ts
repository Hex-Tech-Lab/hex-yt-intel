export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { ChatMessage, ChatRole } from '@/lib/types/chat';

type Row = { id: string; conversation_id: string; role: ChatRole; content: string; created_at: string };

const toMsg = (r: Row): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
});

// Keep the replayed window bounded (the model is stateless — we resend history).
const HISTORY_TURNS = 20;

/** GET — load a thread's messages (RLS scopes to the owner). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, conversation_id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: (data as Row[]).map(toMsg) });
}

/** POST — append a user message, generate + persist the assistant reply. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  // Ownership + grounding: load the conversation (RLS guarantees it's the user's).
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('id, title, analysis_id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  // Persist the user turn.
  const { data: userRow, error: uErr } = await supabase
    .from('chat_messages')
    .insert({ conversation_id: id, user_id: user.id, role: 'user', content })
    .select('id, conversation_id, role, content, created_at')
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Replay recent history for the stateless model.
  const { data: histRows } = await supabase
    .from('chat_messages')
    .select('id, conversation_id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);
  const history = ((histRows as Row[]) || []).reverse();

  // Optional grounding: the linked analysis markdown becomes system context.
  let grounding = '';
  if (conv.analysis_id) {
    const { data: a } = await supabase
      .from('analyses')
      .select('title, analysis_markdown')
      .eq('id', conv.analysis_id)
      .maybeSingle();
    if (a?.analysis_markdown) {
      grounding =
        `You are grounded in this YouTube analysis titled "${a.title ?? ''}". ` +
        `Answer using its content; be concise and cite dimension names where relevant.\n\n` +
        String(a.analysis_markdown).slice(0, 12000);
    }
  }

  const replyText = await generateReply(history, grounding);

  const { data: aRow, error: aErr } = await supabase
    .from('chat_messages')
    .insert({ conversation_id: id, user_id: user.id, role: 'assistant', content: replyText })
    .select('id, conversation_id, role, content, created_at')
    .single();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  // Auto-title from the first user message.
  let newTitle: string | undefined;
  if (conv.title === 'New chat') {
    newTitle = content.slice(0, 60);
    await supabase.from('chat_conversations').update({ title: newTitle }).eq('id', id);
  }

  return NextResponse.json({ userMessage: toMsg(userRow as Row), assistantMessage: toMsg(aRow as Row), title: newTitle });
}

/**
 * The single model seam. Calls OpenRouter when a key is present (history replay +
 * grounding), otherwise returns an honest placeholder. Swap for SSE streaming later.
 */
async function generateReply(history: Row[], grounding: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return (
      "I'm connected to your conversation history (this thread is saved), but no model " +
      'key is configured in this environment yet. Once `OPENROUTER_API_KEY` is set, ' +
      "I'll answer here grounded in the linked analysis and our prior messages."
    );
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (grounding) messages.push({ role: 'system', content: grounding });
  for (const m of history) messages.push({ role: m.role, content: m.content });

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 45000);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yt-intel.getmytestdrive.com',
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-nano-30b-a3b:free',
        temperature: 0.6,
        max_tokens: 1200,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return `The model is unavailable right now (${res.status}). Your messages are saved — try again shortly.`;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || 'No response generated.';
  } catch {
    return 'The model request timed out. Your messages are saved — please try again.';
  }
}
