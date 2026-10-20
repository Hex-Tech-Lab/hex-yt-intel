export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseCommentRunReaderAdapter } from '@/lib/adapters/SupabaseCommentSamplingAdapter';

const AnalysisIdSchema = z.string().uuid();

/** GET /api/comments/runs/[analysisId] — latest comment_sample_runs row for an analysis owned by the caller, or null. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ analysisId: string }> }
) {
  const { analysisId } = await context.params;
  const parsed = AnalysisIdSchema.safeParse(analysisId);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid analysis id' }, { status: 400 });
  }

  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const run = await SupabaseCommentRunReaderAdapter.findLatestRunForAnalysis(parsed.data, user.id);
    return NextResponse.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[comments/runs]', { message, analysisId: parsed.data });
    return NextResponse.json({ error: 'Failed to load comment run' }, { status: 500 });
  }
}
