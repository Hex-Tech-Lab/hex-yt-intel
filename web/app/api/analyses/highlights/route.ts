export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { HIGHLIGHTS_REGISTRY_FALLBACK, clampHighlightsSetting } from '@/lib/utils/highlights-settings';

type HighlightRow = {
  idx: number;
  start_seconds: number;
  end_seconds: number;
  label: string;
  verbatim_excerpt: string | null;
  takeaway_idx: number | null;
};

/**
 * GET /api/analyses/highlights?analysisId=... — request-scoped client, so
 * RLS (owner-only select policy on analysis_highlights) does the ownership
 * check rather than a manual verifyOwnership call.
 *
 * Streams the JSON response per Law #3 (all analytical route handlers MUST
 * stream to extend connection lifetime).
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
    .select('idx, start_seconds, end_seconds, label, verbatim_excerpt, takeaway_idx')
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

  const body = JSON.stringify({
    highlights: (data ?? []).map((row: HighlightRow) => ({
      idx: row.idx,
      start: row.start_seconds,
      end: row.end_seconds,
      label: row.label,
      verbatimExcerpt: row.verbatim_excerpt ?? null,
      takeawayIdx: row.takeaway_idx ?? null,
    })),
    segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
    minSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.minSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'], 2, 15),
    maxSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.maxSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'], 30, 300),
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
}
