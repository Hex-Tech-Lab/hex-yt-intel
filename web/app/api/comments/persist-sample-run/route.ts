export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { verifyContentSig } from '@/lib/stream-token';
import { canonicalJson } from '@/lib/utils/canonical-json';
import { SupabaseCommentSamplingAdapter } from '@/lib/adapters/SupabaseCommentSamplingAdapter';
import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';
import * as Sentry from '@sentry/nextjs';

const PersistedCommentSchema = z.object({
  author: z.string(),
  text: z.string(),
  publishedAt: z.string(),
  likeCount: z.number(),
});

const ClassificationsSchema = z.array(
  z.object({
    commentExternalId: z.string().min(1),
    commentText: z.string(),
    likeCount: z.number().int(),
    publishedAt: z.string(),
    author: z.string(),
    sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
    commentType: z.enum(['question', 'praise', 'criticism', 'suggestion', 'experience', 'spam', 'off_topic']),
    painPoint: z.number().min(0).max(1),
    questionAsked: z.number().min(0).max(1),
    intensity: z.number().min(0).max(2),
    sentimentConfidence: z.number().min(0).max(1),
    lowConfidence: z.boolean(),
    modelUsed: z.string(),
  })
);

const CommentInsightsSchema = z.object({
  population: z.number().int().min(0),
  reportedTotal: z.number().int().min(0),
  sampleSize: z.number().int().min(0),
  classified: z.number().int().min(0),
  failed: z.number().int().min(0),
  lowConfidence: z.number().int().min(0),
  marginOfError: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  marginScope: z.literal('sampled_pool'),
  sentiment: z.object({
    positive: z.number().int().min(0),
    negative: z.number().int().min(0),
    neutral: z.number().int().min(0),
    mixed: z.number().int().min(0),
  }),
  types: z.record(z.string(), z.number().int().min(0)),
  painPointCount: z.number().int().min(0),
  questionCount: z.number().int().min(0),
  costUsd: z.number().min(0),
  model: z.string(),
  completedAt: z.string(),
});

const CochranPayloadSchema = z.object({
  mode: z.literal('cochran'),
  sampledCount: z.number().int().min(0),
  population: z.number().int().min(0),
  insights: CommentInsightsSchema,
  classifications: ClassificationsSchema,
  sampledComments: z.array(PersistedCommentSchema),
});

const PersistRequestSchema = z.object({
  sampleRunId: z.string().uuid(),
  userId: z.string().uuid(),
  sampledCount: z.number().int().min(0),
  status: z.enum(['sampling', 'completed', 'failed']),
  mode: z.enum(['uncapped', 'cochran']).optional(),
  comments: z.array(PersistedCommentSchema).optional(),
  cochran: CochranPayloadSchema.optional(),
  sig: z.string(),
  exp: z.number(),
});

const StatusProbeRequestSchema = z.object({
  sampleRunId: z.string().uuid(),
  userId: z.string().uuid(),
  exp: z.coerce.number(),
  sig: z.string(),
});

/**
 * GET /api/comments/persist-sample-run — signed consume-side redelivery
 * pre-check (queue dispatch brief 2026-10-05 T1, Finding A): Cloudflare
 * Queues is at-least-once, so the worker reads the run's current status
 * BEFORE any paid fetch/classify work and acks with zero work when the run
 * already progressed (sampling/completed). Read-only: the POST contract
 * below is unchanged. The signature uses the same bound-content scheme as
 * the POST bodies (worker/src/crypto.ts#signBoundContent), bound to
 * sampleRunId with purpose 'comments-tier3' — replaying a probe signature
 * into the POST fails PersistRequestSchema (400) before any sig check could
 * matter, and vice versa.
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = StatusProbeRequestSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { sampleRunId, userId, exp, sig } = parsed.data;

  const isValid = await verifyContentSig(canonicalJson({ sampleRunId, userId }), sig, {
    purpose: 'comments-tier3' as const,
    id: sampleRunId,
    exp,
  });
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const service = getSupabaseServiceClient();
  const { data: runRow, error } = await service
    .from('comment_sample_runs')
    .select('status')
    .eq('id', sampleRunId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    Sentry.captureException(error, {
      tags: { operation: 'comments_tier3_status_probe' },
      extra: { sampleRunId },
    });
    return NextResponse.json({ error: 'Failed to load sample run' }, { status: 500 });
  }
  if (!runRow) {
    return NextResponse.json({ error: 'Sample run not found' }, { status: 404 });
  }

  return NextResponse.json({ status: runRow.status });
}

/**
 * POST /api/comments/persist-sample-run — Worker->Vercel S2S callback once
 * the Tier 3 run finishes (or fails). Two modes (Comments Dispatch A,
 * 2026-09-30):
 *
 * - 'uncapped' (legacy): reconciles actual cost against the estimate the
 *   wallet was debited for at start (/api/comments/tier3/start): per the
 *   user's explicit decision, the user is charged actual capped at
 *   estimate, so a shortfall refunds the difference. Every reconciliation
 *   is logged to estimate_reconciliation_log for future estimate-formula
 *   tuning (see comments.credit.estimateParamsVersion in the settings
 *   registry) -- that tuning is a human-reviewed process, not automatic.
 *
 * - 'cochran' (system backfill, zero wallet cost): upserts the Jev
 *   classifications idempotently into comment_classifications, writes
 *   commentInsights into analysis_payload, and writes the sampled comments
 *   into analysis_payload.comments ONLY if the row has none (never
 *   overwrites an existing set). All payload writes go through the
 *   SupabaseAuxRemediationAdapter (never raw SQL in the route).
 *
 * Signature verification is unchanged: the HMAC covers
 * { sampleRunId, sampledCount, status } exactly as before.
 */
export async function POST(request: NextRequest) {
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = PersistRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { sampleRunId, userId, sampledCount, status, mode, comments, cochran, sig, exp } = parsed.data;

  // #378 review P1: the signature covers the WHOLE write body -- canonical
  // JSON of the raw request minus sig/exp -- so no field (classifications,
  // insights, comments, mode) can be altered under a valid signature.
  // Rollout window only: a worker built before this change sends no `mode`
  // and signs the legacy {sampleRunId, sampledCount, status} triple; that is
  // accepted ONLY for mode-less (uncapped) calls, never for a cochran run.
  const { sig: _omitSig, exp: _omitExp, ...signedBody } = rawBody as Record<string, unknown>;
  const binding = { purpose: 'comments-tier3' as const, id: sampleRunId, exp };
  let isValid = await verifyContentSig(canonicalJson(signedBody), sig, binding);
  if (!isValid && mode === undefined && cochran === undefined) {
    isValid = await verifyContentSig(JSON.stringify({ sampleRunId, sampledCount, status }), sig, binding);
  }
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  const runMode = mode ?? 'uncapped';
  if (runMode === 'cochran' && status === 'completed' && !cochran) {
    return NextResponse.json({ error: 'A completed cochran run must carry its payload' }, { status: 400 });
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

  // Cochran path: classifications + insights + never-overwrite comments.
  if (runMode === 'cochran' && cochran && runRow.analysis_id) {
    try {
      const analysisId = runRow.analysis_id as string;
      if (cochran.classifications.length > 0) {
        await SupabaseAuxRemediationAdapter.upsertCommentClassifications(sampleRunId, cochran.classifications);
      }
      await SupabaseAuxRemediationAdapter.writeCommentsPayload(analysisId, {
        commentInsights: cochran.insights,
        comments: cochran.sampledComments,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { operation: 'comments_tier3_cochran_persist' },
        extra: { sampleRunId, analysisId: runRow.analysis_id },
      });
      await service
        .from('comment_sample_runs')
        .update({ status: 'failed', sampled_count: sampledCount, completed_at: new Date().toISOString() })
        .eq('id', sampleRunId);
      return NextResponse.json({ error: 'Cochran persist failed' }, { status: 500 });
    }
  }

  // Legacy uncapped path: persist expanded comment set to analyses table
  // before completing run status. (Cochran mode handles its own payload
  // write above with the never-overwrite guard; it must not clobber an
  // existing uncapped set either, which is why it bypasses this block.)
  if (runMode === 'uncapped' && comments && comments.length > 0 && runRow.analysis_id) {
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

  // Status update. A 'sampling' heartbeat only flips the row out of
  // 'pending' (Dispatch A §1.4) — it must NOT stamp completed_at or clobber
  // a final status if a retry races a completed report.
  if (status === 'sampling') {
    await SupabaseAuxRemediationAdapter.markSampleRunSampling(sampleRunId, runMode);
    return NextResponse.json({ ok: true, refundedCredits: 0 });
  }

  await SupabaseAuxRemediationAdapter.finalizeSampleRun(sampleRunId, {
    status,
    sampledCount,
    mode: runMode,
    cochranN: cochran ? cochran.sampledCount : null,
  });

  // Cochran backfill is system-triggered at zero wallet cost: no estimate
  // reconciliation, no refund path (the wallet was never debited) -- for
  // success AND failure, decided by the signed mode, not payload presence.
  if (runMode === 'cochran') {
    return NextResponse.json({ ok: true, refundedCredits: 0 });
  }

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
