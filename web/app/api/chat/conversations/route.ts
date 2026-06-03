export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { ChatConversation } from '@/lib/types/chat';

type Row = {
  id: string;
  title: string;
  analysis_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

const toConversation = (r: Row): ChatConversation => ({
  id: r.id,
  title: r.title,
  analysisId: r.analysis_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastMessageAt: r.last_message_at,
});

/** GET /api/chat/conversations — list the signed-in user's threads (history). */
export async function GET() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, title, analysis_id, created_at, updated_at, last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[chat] list conversations failed:', error.message);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }
  return NextResponse.json({ conversations: (data as Row[]).map(toConversation) });
}

/** POST /api/chat/conversations — start a new thread (optionally grounded). */
export async function POST(request: NextRequest) {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const analysisId = typeof body.analysisId === 'string' ? body.analysisId : null;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'New chat';

  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ user_id: user.id, analysis_id: analysisId, title })
    .select('id, title, analysis_id, created_at, updated_at, last_message_at')
    .single();

  if (error) {
    console.error('[chat] create conversation failed:', error.message);
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
  return NextResponse.json({ conversation: toConversation(data as Row) }, { status: 201 });
}
