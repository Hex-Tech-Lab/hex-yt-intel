export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabaseCommentSamplingAdapter } from '@/lib/adapters/SupabaseCommentSamplingAdapter';
import * as Sentry from '@sentry/nextjs';

const PersistRequestSchema = z.object({
  sampleRunId: z.string().uuid(),
  userId: z.string().uuid(),
  sampledCount: z.number().int().min(0),
  status: z.enum(['completed', 'failed']),
  comments: z.array(z.object({
    author: z.string(),
    text: z.string(),
    publishedAt: z.string(),
    likeCount: z.number(),
  })).optional(),
  sig: z.string(),
  exp: z.number(),
});

/**
 * POST /api/comments/persist-sample-run — Worker->Vercel S2S callback once
 * the Tier 3 paginated fetch finishes (or fails). Reconciles actual cost
 * against the estimate the wallet was debited for at start
 * (/api/comments/tier3/start): per the user's explicit decision, the user
 * is charged actual capped at estimate, so a shortfall (fetched fewer
 * comments than estimated -- comments can be deleted/disabled mid-run, or
 * the run hit MAX_PAGES) refunds the difference. Every reconciliation is
 * logged to estimate_reconciliation_log for future estimate-formula tuning
 * (see comments.credit.estimateParamsVersion in the settings registry) --
 * that tuning is a human-reviewed process, not automatic.
 */
export async function POST(request: NextRequest) {
  const parsed = PersistRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { sampleRunId, userId, sampledCount, status, comments, sig, exp } = parsed.data;

  const isValid = await verifyContentSig(
    JSON.stringify({ sampleRunId, sampledCount, status }),
    sig,
    { purpose: 'comments-tier3', id: sampleRunId, exp }
  );
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const service = getSupabaseServiceClient();

  const { data: runRow, error: fetchError } = await service
    .from('comment_sample_runs')
    .select('id, user_id, analysis_id, total_comment_count')
    .eq('id', sampleRunId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError || !runRow) {
    return NextResponse.json({ error: 'Sample run not found' }, { status: 404 });
  }

  // Persist expanded comment set to analyses table before completing run status
  if (comments && comments.length > 0 && runRow.analysis_id) {
    const { data: analysisRow } = await service
      .from('analyses')
      .select('analysis_payload, validation_report')
      .eq('id', runRow.analysis_id)
      .maybeSingle();

    if (analysisRow) {
      const priorPayload = (analysisRow.analysis_payload as Record<string, unknown>) || {};
      const priorReport = (analysisRow.validation_report as Record<string, unknown>) || {};

      const updatedPayload = {
        ...priorPayload,
        comments,
      };
      const updatedReport = {
        ...priorReport,
        comments,
      };

      const { error: analysisUpdateError } = await service
        .from('analyses')
        .update({
          analysis_payload: updatedPayload,
          validation_report: updatedReport,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runRow.analysis_id);

      if (analysisUpdateError) {
        Sentry.captureException(analysisUpdateError, {
          tags: { operation: 'comments_tier3_persist_analyses' },
          extra: { sampleRunId, analysisId: runRow.analysis_id },
        });
      }
    }
  }

  await service
    .from('comment_sample_runs')
    .update({ status, sampled_count: sampledCount, completed_at: new Date().toISOString() })
    .eq('id', sampleRunId);

  // Reconcile: refund the gap between what was held at start and the actual
  // cost of what was really fetched. A failed run (sampledCount partial or 0)
  // still only charges for what was actually fetched -- never the full estimate.
  const samplingAdapter = new SupabaseCommentSamplingAdapter();
  const estimatedForTotal = await samplingAdapter.estimateCreditCost({ totalCommentCount: runRow.total_comment_count });
  const estimatedForActual = await samplingAdapter.estimateCreditCost({ totalCommentCount: sampledCount });

  const refundCredits = Math.max(0, estimatedForTotal.estimatedCredits - estimatedForActual.estimatedCredits);
  if (refundCredits > 0) {
    const { error: refundError } = await service.rpc('credit_wallet', { p_user_id: userId, p_amount: refundCredits });
    if (refundError) {
      Sentry.captureException(refundError, { tags: { operation: 'comments_tier3_refund' }, extra: { sampleRunId, userId } });
    }
  }

  await service.from('estimate_reconciliation_log').insert({
    comment_sample_run_id: sampleRunId,
    user_id: userId,
    estimated_comment_count: runRow.total_comment_count,
    actual_comment_count: sampledCount,
    estimated_credits: estimatedForTotal.estimatedCredits,
    actual_credits_charged: estimatedForActual.estimatedCredits,
    estimate_params_version: estimatedForTotal.estimateParamsVersion,
  });

  return NextResponse.json({ ok: true, refundedCredits: refundCredits });
}
