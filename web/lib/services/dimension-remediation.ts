/**
 * Dimension Remediation (per-dimension recovery for partial analyses)
 *
 * sweepStuckAnalyses (analysis-reaper.ts, ADR 007) settles a stuck
 * `processing` row to a terminal state but never regenerates content -- a
 * row genuinely missing dimensions stays missing forever, with "Re-analyze"
 * (full 11-dimension regeneration) as the only user-facing fix. This module
 * fills that gap for the narrower case: an analysis that already has SOME
 * dimensions, just not all of them.
 *
 * Verified against production data (2026-07-30, 179 total analyses): ~45
 * (25%) are `billing_status = 'failed'` with `validation_report.status =
 * 'partial'` and real markdown content -- not a rare edge case.
 *
 * Reuse, not reinvent: this calls the EXACT same worker endpoint and models
 * the live bundle-stream flow uses (CreateAnalysisUseCase -> browser ->
 * worker/src/routes/analysis.ts's `/analyze-llm-stream`, which already
 * accepts `dimensions: number[]` to scope generation to a subset), and
 * merges the result with the EXACT same stitchChunksIntoPayload port
 * analysis-reaper.ts's tryChunkRecovery already reuses. Kept as a sibling
 * service to analysis-reaper.ts, not merged into it -- sweepStuckAnalyses
 * has one consumer today (billing/history status settlement) with one
 * guarantee (never leaves a row in `processing`); remediation is a second
 * consumer with a different guarantee (regenerates content), and mixing
 * them would blur both.
 */
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { env } from '@/lib/env';
import { signStreamToken } from '@/lib/stream-token';
import { resolveAnalysisCascade } from '@/lib/config/cascade';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { stitchChunksIntoPayload, buildDimensionStatus } from '@/lib/services/stitch-analysis-chunks';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { acquireRedisLock, releaseRedisLock } from '@/lib/redis';

/**
 * Explicit per-candidate state machine. Each candidate moves through these
 * stages in order; the harness records which stage it reached so a failure
 * anywhere is attributable, not just a generic "errored".
 */
export enum RemediationStage {
  Found = 'found',
  Claimed = 'claimed',
  ClaimFailed = 'claim_failed', // lost the per-row race -- another run/cron tick owns it
  WorkerCalled = 'worker_called',
  WorkerFailed = 'worker_failed',
  Stitched = 'stitched',
  StitchFailed = 'stitch_failed',
  Persisted = 'persisted',
  PersistRaced = 'persist_raced', // guarded write lost -- a concurrent Re-analyze won
}

/**
 * Harness-level tuning. Kept as named constants, not magic numbers, per this
 * project's settings-registry convention -- these are cron/worker-call
 * pacing knobs, not user-facing config, so they live here rather than in the
 * DB-backed Settings Registry (that registry is for tunables an admin might
 * reasonably change at runtime; these are architectural safety limits).
 */
const HARNESS_LOCK_KEY = 'lock:dimension-remediation-harness';
// Just under the cron cadence (30 min, web/scripts/setup-qstash-cron.ts) so a
// genuinely-stuck harness self-expires before the next tick would also skip
// it forever.
const HARNESS_LOCK_TTL_SECONDS = 25 * 60;
// Per-row claim lease -- independent of the run-level lock above. Defense in
// depth: protects against two DIFFERENT lock holders somehow existing at
// once (e.g. a manual invocation during a scheduled run's window), not the
// primary overlap guard.
const CLAIM_STALE_MINUTES = 10;
// Delay between starting each candidate's worker call. At limit=10 candidates
// this staggers the whole batch over ~40s rather than firing all 10 OpenRouter
// calls simultaneously -- the concern that scales badly at 1,000 candidates,
// not 10, but the pacing mechanism has to exist before the volume does.
const STAGGER_MS = 4_000;

export interface AnalysisGap {
  id: string;
  videoId: string;
  title: string;
  channelTitle: string;
  metadata: Record<string, unknown>;
  analysisMarkdown: string;
  analysisPayload: Record<string, unknown> | null;
  validationReport: unknown;
  missingDimensions: number[];
}

export interface RemediationResult {
  analysisId: string;
  stage: RemediationStage;
  outcome: 'remediated' | 'still_partial' | 'skipped_raced' | 'worker_error' | 'stitch_failed';
  dimensionsRequested: number[];
  dimensionCountAfter?: number;
}

export interface RemediationSweepResult {
  scanned: number;
  remediated: number;
  stillPartial: number;
  skipped: number;
  errored: number;
  lockHeld: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pure: given an analysis's markdown, return which of the 1..TOTAL_DIMENSIONS
 * dimension numbers are absent. Exported for unit testing, same pattern as
 * analysis-reaper.ts's decideReapOutcome.
 */
export function computeMissingDimensions(markdown: string): number[] {
  const parsed = parseToUCISDimensions(markdown);
  const completedDimensions = new Set(Object.keys(parsed).map(Number));
  const missing: number[] = [];
  for (let d = 1; d <= TOTAL_DIMENSIONS; d++) {
    if (!completedDimensions.has(d)) missing.push(d);
  }
  return missing;
}

/**
 * Find analyses with real partial content and no path back to completion
 * except a full re-run. Deliberately narrow: `billing_status = 'failed'`
 * (NOT 'processing' -- that's the reaper's territory) AND
 * `validation_report.status = 'partial'` AND non-empty markdown, so a total
 * loss (empty markdown, nothing to build on) is never mistaken for a
 * remediation candidate.
 */
export async function findAnalysesWithMissingDimensions(opts?: {
  limit?: number;
}): Promise<AnalysisGap[]> {
  const limit = opts?.limit ?? 10;
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('analyses')
    .select('id, video_id, title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status')
    .eq('billing_status', 'failed')
    .eq('validation_report->>status', 'partial')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const gaps: AnalysisGap[] = [];
  for (const row of data ?? []) {
    const markdown = (row as { analysis_markdown?: string }).analysis_markdown ?? '';
    if (!markdown.trim()) continue; // total loss -- only a full re-run helps, not this path

    const missingDimensions = computeMissingDimensions(markdown);
    if (missingDimensions.length === 0) continue; // shouldn't happen given the status filter, but never remediate a row that's actually already whole

    const report = (row as { validation_report?: unknown }).validation_report;
    const reportMetadata =
      report && typeof report === 'object' && !Array.isArray(report)
        ? ((report as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
        : undefined;

    gaps.push({
      id: (row as { id: string }).id,
      videoId: (row as { video_id: string }).video_id,
      title: (row as { title?: string }).title ?? '',
      channelTitle: (row as { channel_title?: string }).channel_title ?? '',
      metadata: reportMetadata ?? {},
      analysisMarkdown: markdown,
      analysisPayload: (row as { analysis_payload?: Record<string, unknown> | null }).analysis_payload ?? null,
      validationReport: report,
      missingDimensions,
    });
  }
  return gaps;
}

/**
 * Atomically claim a row for remediation: guarded UPDATE that only succeeds
 * if the row is still `billing_status='failed'` AND no other claim is
 * currently active (validation_report.remediation_claimed_at is null or
 * older than CLAIM_STALE_MINUTES). Two concurrent claim attempts on the same
 * row serialize on Postgres's own row lock during the UPDATE -- only one can
 * win, the loser's WHERE re-evaluates against the now-committed row and
 * matches zero rows. Same single-winner guarded-UPDATE pattern
 * analysis-reaper.ts already uses, just with a lease field instead of
 * billing_status as the guard (a full remediation run may take longer than
 * the reaper's one-shot UPDATE, so billing_status alone can't distinguish
 * "not started" from "in progress").
 */
async function claimGap(gap: AnalysisGap): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MINUTES * 60_000).toISOString();
  const baseReport =
    gap.validationReport && typeof gap.validationReport === 'object' && !Array.isArray(gap.validationReport)
      ? (gap.validationReport as Record<string, unknown>)
      : {};

  const { count, error } = await service
    .from('analyses')
    .update(
      { validation_report: { ...baseReport, remediation_claimed_at: nowIso } },
      { count: 'exact' }
    )
    .eq('id', gap.id)
    .eq('billing_status', 'failed')
    .or(`validation_report->>remediation_claimed_at.is.null,validation_report->>remediation_claimed_at.lt.${staleCutoff}`);

  if (error) {
    Sentry.captureException(error, { tags: { service: 'dimension-remediation', phase: 'claim' }, extra: { analysisId: gap.id } });
    return false;
  }
  return (count ?? 0) > 0;
}

/** Clear a claim after a failed remediation attempt so the next tick can retry immediately, rather than waiting out CLAIM_STALE_MINUTES. */
async function releaseClaim(gap: AnalysisGap): Promise<void> {
  const service = getSupabaseServiceClient();
  const baseReport =
    gap.validationReport && typeof gap.validationReport === 'object' && !Array.isArray(gap.validationReport)
      ? (gap.validationReport as Record<string, unknown>)
      : {};
  const { remediation_claimed_at: _drop, ...withoutClaim } = baseReport as Record<string, unknown> & { remediation_claimed_at?: unknown };
  const { error } = await service
    .from('analyses')
    .update({ validation_report: withoutClaim })
    .eq('id', gap.id)
    .eq('billing_status', 'failed');
  if (error) {
    // Non-fatal: worst case the claim just expires naturally after CLAIM_STALE_MINUTES.
    console.warn('[dimension-remediation] releaseClaim failed, will expire naturally', { analysisId: gap.id, error: error.message });
  }
}

/**
 * Consume the worker's SSE stream server-side (no browser present in a cron
 * context) and accumulate the JSON fragments into one chunk-shaped payload,
 * matching what a single bundle stream produces for stitchChunksIntoPayload.
 */
async function collectDimensionsFromWorker(
  gap: AnalysisGap,
  models: string[],
  cascade: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>
): Promise<Record<string, unknown> | null> {
  const token = await signStreamToken(gap.videoId, gap.id, models);

  const body = {
    videoId: gap.videoId,
    analysisId: gap.id,
    transcript: '', // worker re-fetches when missing/placeholder -- same fallback the live route already relies on
    metadata: {
      title: gap.title,
      channelTitle: gap.channelTitle,
      publishedAt: (gap.metadata.publishedAt as string) ?? '',
      duration: (gap.metadata.duration as number) ?? 0,
      viewCount: (gap.metadata.viewCount as string | number) ?? '0',
      likeCount: (gap.metadata.likeCount as string | number) ?? '0',
      commentCount: (gap.metadata.commentCount as string | number) ?? '0',
    },
    persona: (gap.metadata.persona as string) ?? 'creator',
    timezone: (gap.metadata.timezone as string) ?? 'UTC',
    models,
    cascade,
    dimensions: gap.missingDimensions,
    sig: token.sig,
    exp: token.exp,
  };

  const res = await fetch(`${env.cloudflareWorkerUrl}/analyze-llm-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    console.error('[dimension-remediation] worker call failed', { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) });
    Sentry.captureMessage('dimension-remediation: worker non-2xx response', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) } },
    });
    return null;
  }

  // The worker emits newline-delimited SSE `data: {...}` frames, each a
  // fragment (dimension / persona / classification / monetizationVerdict /
  // knowledgeGraph piece) -- same shape a browser's useSSEStream parses.
  // Collected fragments are merged into one chunk-shaped object.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const chunk: Record<string, unknown> = { dimensions: [] as unknown[] };

  const mergeFragment = (frag: Record<string, unknown>) => {
    if (frag.type === 'dimension' && frag.dimension) {
      (chunk.dimensions as unknown[]).push(frag.dimension);
    } else if (frag.type === 'persona' && frag.persona) {
      chunk.persona = frag.persona;
    } else if (frag.type === 'classification' && frag.classification) {
      chunk.classification = frag.classification;
    } else if (frag.type === 'monetizationVerdict' && frag.monetizationVerdict) {
      chunk.monetizationVerdict = frag.monetizationVerdict;
    } else if (frag.type === 'knowledgeGraph' && frag.knowledgeGraph) {
      chunk.knowledgeGraph = frag.knowledgeGraph;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        mergeFragment(JSON.parse(jsonStr));
      } catch (parseErr) {
        console.warn('[dimension-remediation] unparseable SSE fragment, skipping', { analysisId: gap.id, err: parseErr instanceof Error ? parseErr.message : String(parseErr) });
      }
    }
  }

  return (chunk.dimensions as unknown[]).length > 0 ? chunk : null;
}

/**
 * Remediate a single gap: claim it atomically, call the worker for just the
 * missing dimensions, stitch the result in with the existing content,
 * persist if it actually improved the analysis. Every exit path is tagged
 * with the RemediationStage it reached, so a run's results are attributable
 * to a specific step, not just pass/fail.
 */
export async function remediateAnalysis(gap: AnalysisGap): Promise<RemediationResult> {
  const persistenceAdapter = new SupabasePersistenceAdapter();

  const claimed = await claimGap(gap);
  if (!claimed) {
    return { analysisId: gap.id, stage: RemediationStage.ClaimFailed, outcome: 'skipped_raced', dimensionsRequested: gap.missingDimensions };
  }

  const cascade = await resolveAnalysisCascade();
  const models = cascade.map((c) => c.model);

  const newChunk = await collectDimensionsFromWorker(gap, models, cascade);
  if (!newChunk) {
    await releaseClaim(gap);
    return { analysisId: gap.id, stage: RemediationStage.WorkerFailed, outcome: 'worker_error', dimensionsRequested: gap.missingDimensions };
  }

  // Existing content, wrapped as a "chunk" so stitchChunksIntoPayload's
  // existing merge-by-map logic can combine it with the newly-generated one
  // without any new merge code.
  const existingChunk: Record<string, unknown> = gap.analysisPayload
    ? gap.analysisPayload
    : { dimensions: Object.values(parseToUCISDimensions(gap.analysisMarkdown)) };

  const chunkMap = new Map<number, unknown>([
    [1, existingChunk],
    [2, newChunk],
  ]);
  const stitchResult = stitchChunksIntoPayload(chunkMap, 2);
  if (!stitchResult.payload) {
    Sentry.captureMessage('dimension-remediation: stitch produced no payload', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id } },
    });
    await releaseClaim(gap);
    return { analysisId: gap.id, stage: RemediationStage.StitchFailed, outcome: 'stitch_failed', dimensionsRequested: gap.missingDimensions };
  }

  const { dimensionStatus, validationStatus, billingStatus } = buildDimensionStatus(stitchResult.payload);
  const dimensionCountAfter = dimensionStatus.filter((d) => d.status === 'done').length;
  const nowIso = new Date().toISOString();
  const baseReport =
    gap.validationReport && typeof gap.validationReport === 'object' && !Array.isArray(gap.validationReport)
      ? (gap.validationReport as Record<string, unknown>)
      : {};
  const newReport = {
    ...baseReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    remediated: true,
    remediated_at: nowIso,
    remediated_dimensions: gap.missingDimensions,
  };

  const { updated } = await persistenceAdapter.updateAnalysisResult({
    analysisId: gap.id,
    markdown: stitchResult.markdown,
    payload: stitchResult.payload,
    model: null,
    validationPassed: stitchResult.validationPassed,
    validationReport: newReport,
    guardBillingStatus: 'failed',
  });
  if (!updated) {
    // Guarded write lost to a concurrent legitimate change (e.g. a
    // "Re-analyze" that moved the row off billing_status='failed' between
    // our claim and this write). Leave the claim in place rather than
    // releasing it -- the row is no longer a remediation candidate at all,
    // so there is nothing to retry.
    return { analysisId: gap.id, stage: RemediationStage.PersistRaced, outcome: 'skipped_raced', dimensionsRequested: gap.missingDimensions };
  }

  return {
    analysisId: gap.id,
    stage: RemediationStage.Persisted,
    outcome: dimensionCountAfter >= TOTAL_DIMENSIONS ? 'remediated' : 'still_partial',
    dimensionsRequested: gap.missingDimensions,
    dimensionCountAfter,
  };
}

/**
 * Harness: owns run-level concurrency, not just per-row correctness.
 *
 * 1. Run-level lock (Redis, NX+TTL): at most one harness invocation is ever
 *    active at a time, repo-wide. If a scheduled tick fires while a previous
 *    run is still in flight (a slow run, or the interval being tightened to
 *    5/2/3 min because the backlog turned out to be worse than expected),
 *    the new invocation exits immediately instead of double-processing the
 *    same candidates. This is the PRIMARY overlap guard.
 * 2. Per-row claim (see claimGap): defense in depth, not the primary
 *    mechanism -- covers a manual invocation racing a scheduled one, which
 *    the run-level lock alone wouldn't catch if triggered from two different
 *    processes without going through this same lock key.
 * 3. Staggered pacing (STAGGER_MS between candidates): candidates are
 *    processed sequentially, not via Promise.all, specifically so this
 *    doesn't fire N simultaneous OpenRouter calls. At limit=10 this is
 *    already true by construction (a plain for-loop is sequential), but the
 *    delay is explicit so the pacing is a real, tunable property of the
 *    harness rather than an accident of not having parallelized yet -- the
 *    thing to widen if a future limit=1000 needs batched concurrency instead
 *    of pure sequential staggering.
 */
export async function runRemediationHarness(opts?: { limit?: number }): Promise<RemediationSweepResult> {
  const lockAcquired = await acquireRedisLock(HARNESS_LOCK_KEY, HARNESS_LOCK_TTL_SECONDS);
  if (!lockAcquired) {
    console.log('[dimension-remediation] harness already running, skipping this tick');
    return { scanned: 0, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, lockHeld: false };
  }

  try {
    const gaps = await findAnalysesWithMissingDimensions(opts);
    const result: RemediationSweepResult = { scanned: gaps.length, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, lockHeld: true };

    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i]!;
      try {
        const outcome = await remediateAnalysis(gap);
        console.log('[dimension-remediation] candidate processed', { analysisId: gap.id, stage: outcome.stage, outcome: outcome.outcome });
        if (outcome.outcome === 'remediated') result.remediated++;
        else if (outcome.outcome === 'still_partial') result.stillPartial++;
        else if (outcome.outcome === 'skipped_raced') result.skipped++;
        else result.errored++;
      } catch (err) {
        Sentry.captureException(err, { tags: { service: 'dimension-remediation' }, extra: { analysisId: gap.id } });
        result.errored++;
      }

      if (i < gaps.length - 1) {
        await sleep(STAGGER_MS);
      }
    }
    return result;
  } finally {
    await releaseRedisLock(HARNESS_LOCK_KEY);
  }
}
