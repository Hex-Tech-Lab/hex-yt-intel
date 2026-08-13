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
    highlights: (data ?? []).map((h) => ({ idx: h.idx, start: h.start_seconds, end: h.end_seconds, label: h.label })),
    segmentDurationSeconds: Number(settings['highlights.segmentDurationSeconds']),
    contextLeadSeconds: Number(settings['highlights.contextLeadSeconds']),
  });
}
