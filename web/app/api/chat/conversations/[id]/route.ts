export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

// Database row schema for validation before persisting
const ChatConversationUpdateSchema = z.object({
  title: z.string().max(120).optional(),
  analysis_id: z.string().uuid().nullable().optional(),
}).strict();

/** PATCH /api/chat/conversations/[id] — rename a thread. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Verify ownership before modification (defense-in-depth, despite RLS)
    const { data: conversation, error: fetchError } = await supabase
      .from('chat_conversations')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !conversation || conversation.user_id !== user.id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const body: unknown = await request.json().catch(() => ({}));
    const payloadSchema = z.object({
      title: z.string().transform(v => v.trim().slice(0, 120)).optional(),
      analysisId: z.string().uuid().nullable().optional(),
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
    }
    const { title, analysisId } = parsed.data;

    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (analysisId !== undefined) updates.analysis_id = analysisId;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Payload must contain title or analysisId' }, { status: 400 });
    }

    // Validate database row before persisting
    const validated = ChatConversationUpdateSchema.parse(updates);

    const { error } = await supabase.from('chat_conversations').update(validated).eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[chat] update conversation failed:', error.message);
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[chat] PATCH conversation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/chat/conversations/[id] — delete a thread (cascades messages). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Verify ownership before deletion (defense-in-depth, despite RLS)
    const { data: conversation, error: fetchError } = await supabase
      .from('chat_conversations')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !conversation || conversation.user_id !== user.id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Validate ID format before database operation
    const idSchema = z.string().uuid();
    const validatedId = idSchema.parse(id);

    const { error } = await supabase.from('chat_conversations').delete().eq('id', validatedId).eq('user_id', user.id);
    if (error) {
      console.error('[chat] delete conversation failed:', error.message);
      return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[chat] DELETE conversation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
