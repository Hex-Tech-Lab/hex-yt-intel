export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

/** PATCH /api/chat/conversations/[id] — rename a thread. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  // RLS scopes the update to the owner.
  const { error } = await supabase.from('chat_conversations').update(updates).eq('id', id);
  if (error) {
    console.error('[chat] update conversation failed:', error.message);
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/chat/conversations/[id] — delete a thread (cascades messages). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('chat_conversations').delete().eq('id', id);
  if (error) {
    console.error('[chat] delete conversation failed:', error.message);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
