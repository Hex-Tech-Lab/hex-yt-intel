export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

const REGISTRY_FALLBACK = {
  'highlights.segmentDurationSeconds': 10,
  'highlights.contextLeadSeconds': 2.5,
} as const;

/** A malformed/missing/out-of-range registry value must never reach the
 *  client as-is -- it drives setTimeout durations and seek offsets in
 *  HighlightsScrubber. Same min/max bounds as the migration's own
 *  validation jsonb (20260813222120_highlights_reel_settings_registry.sql). */
function clampSetting(value: unknown, fallback: number, min: number, max: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) return fallback;
  return numericValue;
}

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

  const settings = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_FALLBACK), REGISTRY_FALLBACK);

  return NextResponse.json({
    highlights: (data ?? []).map((row) => ({ idx: row.idx, start: row.start_seconds, end: row.end_seconds, label: row.label })),
    segmentDurationSeconds: clampSetting(settings['highlights.segmentDurationSeconds'], REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampSetting(settings['highlights.contextLeadSeconds'], REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
  });
}
