export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { HIGHLIGHTS_REGISTRY_FALLBACK, clampHighlightsSetting } from '@/lib/utils/highlights-settings';

/**
 * GET /api/analyses/highlights?analysisId=... — request-scoped client, so
 * RLS (owner-only select policy on analysis_highlights) does the ownership
 * check rather than a manual verifyOwnership call.
 */
export async function GET(request: NextRequest) {
  const parsed = z.object({ analysisId: z.string().uuid() }).safeParse({
    analysisId: request.nextUrl.searchParams.get('analysisId'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid analysisId' }, { status: 400 });
  }

  const supabase = await getSupabaseClientWithAuth();
  const { data, error } = await supabase
    .from('analysis_highlights')
    .select('idx, start_seconds, end_seconds, label')
    .eq('analysis_id', parsed.data.analysisId)
    .order('idx', { ascending: true });

  if (error) {
    console.error('[analyses/highlights] query failed:', error.message);
    return NextResponse.json({ error: 'Failed to load highlights' }, { status: 500 });
  }

  const settings = await SupabaseSettingsAdapter.getRegistrySettings(
    Object.keys(HIGHLIGHTS_REGISTRY_FALLBACK),
    HIGHLIGHTS_REGISTRY_FALLBACK
  );

  return NextResponse.json({
    highlights: (data ?? []).map((row) => ({ idx: row.idx, start: row.start_seconds, end: row.end_seconds, label: row.label })),
    segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
  });
}
