export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { HighlightsResponseSchema } from '@/lib/validators/highlights';
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
 */
export async function GET(request: NextRequest) {
  const analysisId = request.nextUrl.searchParams.get('analysisId');
  const publicToken = request.nextUrl.searchParams.get('publicToken');
  const parsed = z.object({ analysisId: z.string().uuid() }).safeParse({ analysisId });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid analysisId' }, { status: 400 });
  }

  const supabase = await getSupabaseClientWithAuth();
  
  if (publicToken) {
    // Check if valid public token
    const { data: analysis, error: pErr } = await supabase
      .from('analyses')
      .select('id')
      .eq('id', parsed.data.analysisId)
      .eq('share_token', publicToken)
      .single();
      
    if (pErr || !analysis) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // RLS handles owner check
  }

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

  const rawHighlights = (data ?? []).map((row: HighlightRow) => ({
    idx: row.idx,
    start: row.start_seconds,
    end: row.end_seconds,
    label: row.label,
    verbatimExcerpt: row.verbatim_excerpt ?? null,
    takeawayIdx: row.takeaway_idx ?? null,
  }));
  
  if (rawHighlights.length === 0) {
    return NextResponse.json({
      analysisId: parsed.data.analysisId,
      highlights: [],
      segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
      contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
      minSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.minSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'], 2, 15),
      maxSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.maxSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'], 30, 300),
    }, { status: 200 });
  }

  const validationRes = HighlightsResponseSchema.safeParse({
    analysisId: parsed.data.analysisId,
    highlights: rawHighlights,
  });

  let validHighlights: Record<string, unknown>[] = rawHighlights;
  if (!validationRes.success) {
    console.warn('[analyses/highlights] Schema validation failed', validationRes.error.issues);
    Sentry.captureMessage('Validation dropped payload at HighlightsResponseSchema', {
      level: 'warning',
      extra: {
        boundary: 'HighlightsResponseSchema',
        issueCount: validationRes.error.issues.length,
        issuePaths: validationRes.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
      },
    });
    // Graceful degradation: return raw rows (preprocess already coerced what it could).
  } else {
    validHighlights = validationRes.data.highlights;
  }

  const payload = {
    analysisId: parsed.data.analysisId,
    highlights: validHighlights,
    segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
    minSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.minSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'], 2, 15),
    maxSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.maxSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'], 30, 300),
  };

  return NextResponse.json(payload, { status: 200 });
}
