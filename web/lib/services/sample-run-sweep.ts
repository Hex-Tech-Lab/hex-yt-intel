/**
 * Global stale comment_sample_runs sweep (T12c; runs inside the ADR 007 reaper
 * QStash webhook, after sweepStuckAnalyses).
 *
 * Before this, a run stuck in 'pending' or 'sampling' was only released when
 * the same analysis was re-finalized (failStaleSystemSampleRuns). Nothing else
 * reaped them, so an orphaned run could hold the uq_comment_sample_runs_system_per_analysis
 * index for an analysis that is never re-finalized.
 *
 * Rules (thresholds are Settings Registry keys, fallbacks equal the seeds in
 * migration 20261013120000):
 *  - 'pending' older than comments.sweep.pendingStaleMinutes and never
 *    re-enqueued: re-enqueue once (conditional reenqueued_at stamp = the winner).
 *  - 'pending' whose re-enqueue is itself older than the threshold: mark failed.
 *  - 'sampling' whose claim (claimed_at; legacy rows with no claimed_at use reenqueued_at, then created_at)
 *    is older than comments.sweep.samplingStaleMinutes: mark failed. A CF Queues consumer is capped at
 *    15 min wall time, so the 30 min default cannot fail a genuinely live run.
 *
 * Every transition is a conditional UPDATE (WHERE status = ...) so the sweep
 * cannot race a live consumer: a consumer claim (pending -> sampling) or a
 * finalize (-> completed/failed) that lands first makes the sweep's update
 * a no-op.
 */
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { SupabaseAuxRemediationAdapter, type SweepRunRow } from '@/lib/adapters/SupabaseAuxRemediationAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { enqueueInsertedSystemSampleRun } from '@/lib/services/aux-remediation';

export const SAMPLE_RUN_SWEEP_FALLBACK_MINUTES = 30;
const SWEEP_BATCH_LIMIT = 200;

export interface SampleRunSweepResult {
  requeued: number;
  failedPending: number;
  failedSampling: number;
  errors: number;
}

/** Sweep one pass. Safe to run repeatedly; a second pass only acts on what is still stale. */
export async function sweepStaleSampleRuns(): Promise<SampleRunSweepResult> {
  const settings = await SupabaseSettingsAdapter.getRegistrySettings(
    ['comments.sweep.pendingStaleMinutes', 'comments.sweep.samplingStaleMinutes'],
    {
      'comments.sweep.pendingStaleMinutes': SAMPLE_RUN_SWEEP_FALLBACK_MINUTES,
      'comments.sweep.samplingStaleMinutes': SAMPLE_RUN_SWEEP_FALLBACK_MINUTES,
    }
  );
  const pendingMinutes = Number(settings['comments.sweep.pendingStaleMinutes']) || SAMPLE_RUN_SWEEP_FALLBACK_MINUTES;
  const samplingMinutes = Number(settings['comments.sweep.samplingStaleMinutes']) || SAMPLE_RUN_SWEEP_FALLBACK_MINUTES;

  const now = Date.now();
  const pendingCutoff = new Date(now - pendingMinutes * 60_000).toISOString();
  const samplingCutoff = new Date(now - samplingMinutes * 60_000).toISOString();
  const result: SampleRunSweepResult = { requeued: 0, failedPending: 0, failedSampling: 0, errors: 0 };

  // Per-row containment: one failing row is counted and reported, the rest still run.
  const attempt = async (phase: string, sampleRunId: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      result.errors++;
      console.error('[sample-run-sweep] transition failed', { phase, sampleRunId, err: err instanceof Error ? err.message : String(err) });
      Sentry.captureException(err, { tags: { service: 'sample-run-sweep', phase }, extra: { sampleRunId } });
    }
  };

  // 1. Never-re-enqueued stale pending: re-enqueue once.
  for (const row of await SupabaseAuxRemediationAdapter.findPendingRunsForRequeue(pendingCutoff, SWEEP_BATCH_LIMIT)) {
    await attempt('requeue', row.id, async () => {
      if (!(await SupabaseAuxRemediationAdapter.markSampleRunReenqueued(row.id, new Date(now).toISOString()))) return;
      if (await reenqueueRun(row)) result.requeued++;
    });
  }

  // 2. Re-enqueued but still pending past the threshold: fail it.
  for (const row of await SupabaseAuxRemediationAdapter.findPendingRunsForFailure(pendingCutoff, SWEEP_BATCH_LIMIT)) {
    await attempt('fail_pending', row.id, async () => {
      if (await SupabaseAuxRemediationAdapter.failStaleSampleRun(row.id, 'pending', pendingCutoff)) result.failedPending++;
    });
  }

  // 3. Sampling past the threshold (no owner will finish it): fail it.
  for (const row of await SupabaseAuxRemediationAdapter.findSamplingRunsForFailure(samplingCutoff, SWEEP_BATCH_LIMIT)) {
    await attempt('fail_sampling', row.id, async () => {
      if (await SupabaseAuxRemediationAdapter.failStaleSampleRun(row.id, 'sampling', samplingCutoff)) result.failedSampling++;
    });
  }

  return result;
}

/**
 * Re-enqueue a run the sweep just claimed. Returns false when the enqueue did
 * not happen; the run then stays pending with reenqueued_at set and pass 2
 * fails it once the threshold passes (never a second paid enqueue).
 */
async function reenqueueRun(row: SweepRunRow): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const { data: analysis, error } = await service
    .from('analyses')
    .select('video_id')
    .eq('id', row.analysis_id)
    .maybeSingle();
  if (error) throw error;
  if (!analysis?.video_id) {
    // Not a transient failure: the parent analysis is gone or has no video id. Surface it,
    // then leave the run pending so pass 2 fails it after the threshold.
    const message = 'analysis missing or has no video_id; cannot re-enqueue';
    console.error('[sample-run-sweep] ' + message, { sampleRunId: row.id, analysisId: row.analysis_id });
    Sentry.captureMessage(message, { level: 'warning', tags: { service: 'sample-run-sweep', phase: 'requeue_no_video' }, extra: { sampleRunId: row.id } });
    return false;
  }
  return enqueueInsertedSystemSampleRun(
    { analysisId: row.analysis_id, userId: row.user_id, videoId: analysis.video_id as string },
    row.id,
    row.total_comment_count
  );
}
