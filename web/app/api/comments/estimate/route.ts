export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabaseCommentSamplingAdapter } from '@/lib/adapters/SupabaseCommentSamplingAdapter';

const EstimateRequestSchema = z.object({
  totalCommentCount: z.number().int().min(0).max(1_000_000),
});

/**
 * POST /api/comments/estimate — Tier 3 (uncapped) pre-commit credit estimate.
 * Per the user's explicit product decision (2026-07-24): Tier 3 is never
 * capped, but the estimated cost must be shown BEFORE the user commits to a
 * wallet draw-down. `totalCommentCount` comes from the video metadata the
 * frontend already fetched (no new YouTube API call from this route).
 */
export async function POST(request: NextRequest) {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = EstimateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const samplingAdapter = new SupabaseCommentSamplingAdapter();
  const estimate = await samplingAdapter.estimateCreditCost({ totalCommentCount: parsed.data.totalCommentCount });

  return NextResponse.json(estimate);
}
