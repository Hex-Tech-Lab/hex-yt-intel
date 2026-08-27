export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { HighlightsResponseSchema } from '@/lib/validators/highlights';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { HIGHLIGHTS_REGISTRY_FALLBACK, clampHighlightsSetting } from '@/lib/utils/highlights-settings';

type HighlightRow = Record<string, unknown> & {
  idx: number;
  start_seconds?: number;
  end_seconds?: number;
  label?: string;
  verbatim_excerpt?: string | null;
  takeaway_idx?: number | null;
  parent_takeaway_idx?: number | null;
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

  const settingsPayload = {
    segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
    minSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.minSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'], 2, 15),
    maxSegmentDurationSeconds: clampHighlightsSetting(settings['highlights.maxSegmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'], 30, 300),
  };

  const rows = (data ?? []) as HighlightRow[];
  if (!rows || rows.length === 0) {
    return NextResponse.json({
      analysisId: parsed.data.analysisId,
      highlights: [],
      ...settingsPayload,
    }, { status: 200 });
  }

  const rawHighlights = rows.map((row) => ({
    id: row.id as string | undefined,
    start: (row.start_seconds ?? row.start_time ?? row.startTime ?? (row as Record<string, unknown>).start) as unknown,
    end: (row.end_seconds ?? row.end_time ?? row.endTime ?? (row as Record<string, unknown>).end) as unknown,
    title: (row.title ?? row.headline ?? row.label ?? (row as Record<string, unknown>).key_point) as unknown,
    summary: (row.summary ?? row.description ?? (row as Record<string, unknown>).text ?? '') as unknown,
    idx: row.idx,
    label: row.label,
    verbatim_excerpt: row.verbatim_excerpt,
    takeaway_idx: row.takeaway_idx,
    parent_takeaway_idx: (row.parent_takeaway_idx ?? row.takeaway_idx ?? (row as Record<string, unknown>).takeawayIdx ?? (row as Record<string, unknown>).parentTakeawayIdx) as unknown,
  }));

  const parsedResponse = HighlightsResponseSchema.safeParse({
    analysisId: parsed.data.analysisId,
    highlights: rawHighlights,
  });

  const validHighlights = parsedResponse.success ? parsedResponse.data.highlights : [];
  if (!parsedResponse.success) {
    console.warn('[HighlightsRoute] Schema validation dropped malformed highlights', parsedResponse.error.issues);
    Sentry.captureMessage('Validation dropped payload at HighlightsResponseSchema', {
      level: 'warning',
      extra: {
        boundary: 'HighlightsResponseSchema',
        issueCount: parsedResponse.error.issues.length,
        issuePaths: parsedResponse.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
      },
    });
  }

  return NextResponse.json({
    analysisId: parsed.data.analysisId,
    highlights: validHighlights,
    ...settingsPayload,
  }, { status: 200 });
}
