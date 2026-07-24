export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { SupabaseCommentSamplingAdapter } from '@/lib/adapters/SupabaseCommentSamplingAdapter';
import { StreamTokenAdapter } from '@/lib/adapters/StreamTokenAdapter';
import { env } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';

const StartRequestSchema = z.object({
  videoId: z.string().min(1),
  totalCommentCount: z.number().int().min(1).max(1_000_000),
});

/**
 * POST /api/comments/tier3/start — approves and kicks off an uncapped Tier 3
 * comment fetch. Debits the estimated credit cost from the user's wallet
 * atomically (debit_credit_wallet RPC -- see migration 20260725100000),
 * creates the audit row, then signs and calls the Worker's enqueue endpoint.
 *
 * Per the user's explicit decision (2026-07-24): charge actual, capped at
 * estimate. This debits the ESTIMATE as a hold; /api/comments/persist-sample-run
 * refunds the difference once the real sampled_count is known.
 */
export async function POST(request: NextRequest) {
  const authClient = await getSupabaseClientWithAuth();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = StartRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { videoId, totalCommentCount } = parsed.data;

  const service = getSupabaseServiceClient();

  // Find the user's most recent analysis for this video -- comment_sample_runs.analysis_id
  // is a required FK; Tier 3 sampling only makes sense against an existing analysis.
  const { data: analysisRow, error: analysisError } = await service
    .from('analyses')
    .select('id')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError || !analysisRow) {
    return NextResponse.json({ error: 'No analysis found for this video' }, { status: 404 });
  }

  const samplingAdapter = new SupabaseCommentSamplingAdapter();
  const estimate = await samplingAdapter.estimateCreditCost({ totalCommentCount });

  const { data: debited, error: debitError } = await service.rpc('debit_credit_wallet', {
    p_user_id: user.id,
    p_amount: estimate.estimatedCredits,
  });

  if (debitError) {
    Sentry.captureException(debitError, { tags: { operation: 'comments_tier3_debit' }, extra: { userId: user.id } });
    return NextResponse.json({ error: 'Failed to charge credits' }, { status: 500 });
  }
  if (!debited) {
    return NextResponse.json({ error: 'Insufficient credit balance', estimatedCredits: estimate.estimatedCredits }, { status: 402 });
  }

  const { data: runRow, error: insertError } = await service
    .from('comment_sample_runs')
    .insert({
      analysis_id: analysisRow.id,
      user_id: user.id,
      tier: 3,
      total_comment_count: totalCommentCount,
      requested_percent: 100,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError || !runRow) {
    // Refund the hold -- the run row never got created, so nothing was ever queued.
    await service.rpc('credit_wallet', { p_user_id: user.id, p_amount: estimate.estimatedCredits });
    Sentry.captureException(insertError, { tags: { operation: 'comments_tier3_insert_run' }, extra: { userId: user.id, videoId } });
    return NextResponse.json({ error: 'Failed to create sample run' }, { status: 500 });
  }

  const tokenAdapter = new StreamTokenAdapter();
  const token = await tokenAdapter.signCommentsTier3Token({ sampleRunId: runRow.id, userId: user.id });

  try {
    const enqueueRes = await fetch(`${env.cloudflareWorkerUrl}/comments/tier3/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleRunId: runRow.id,
        videoId,
        userId: user.id,
        totalCommentCount,
        appUrl: env.appUrl || 'https://yt-intel.getmytestdrive.com',
        sig: token.sig,
        exp: token.exp,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!enqueueRes.ok) throw new Error(`Worker enqueue returned ${enqueueRes.status}`);
  } catch (err) {
    // Refund the hold and mark the run failed -- it was never actually queued.
    await service.rpc('credit_wallet', { p_user_id: user.id, p_amount: estimate.estimatedCredits });
    await service.from('comment_sample_runs').update({ status: 'failed' }).eq('id', runRow.id);
    Sentry.captureException(err, { tags: { operation: 'comments_tier3_enqueue' }, extra: { userId: user.id, sampleRunId: runRow.id } });
    return NextResponse.json({ error: 'Failed to start Tier 3 fetch' }, { status: 502 });
  }

  await service.from('comment_sample_runs').update({ status: 'sampling' }).eq('id', runRow.id);

  return NextResponse.json({ sampleRunId: runRow.id, status: 'sampling', estimatedCredits: estimate.estimatedCredits });
}
