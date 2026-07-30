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
 *
 * Concurrency: a single Redis run-level lock (see runRemediationHarness) is
 * the ONLY overlap guard, plus the existing guardBillingStatus write-time
 * check. An earlier version of this file also had a per-row Postgres
 * claim/lease -- removed after review: with the run-level lock guaranteeing
 * at most one harness invocation is ever active, no two callers can ever
 * reach a given row concurrently, so the claim was pure duplication of what
 * the lock (for cross-run safety) and guardBillingStatus (for the final
 * write) already cover between them. The lock earns its keep here in a way
 * analysis-reaper.ts's equivalent guardBillingStatus-only pattern doesn't
 * need to worry about: this module's per-row work fires a real paid
 * OpenRouter call before it ever reaches the write, so a lost race after
 * that call would waste money already spent, not just a discarded local
 * computation.
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
 * Per-candidate outcome. Doubles as the tally key in RemediationSweepResult
 * (runRemediationHarness switches on this directly) -- deliberately a single
 * field, not a separate stage+outcome pair, so there is exactly one place a
 * result can say what happened.
 */
export enum RemediationStage {
  WorkerFailed = 'worker_failed',
  StitchFailed = 'stitch_failed',
  PersistRaced = 'persist_raced', // guarded write lost -- a concurrent Re-analyze won
  Remediated = 'remediated', // persisted, all TOTAL_DIMENSIONS now present
  StillPartial = 'still_partial', // persisted, improved but still short
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
// Delay between starting each candidate's worker call. At limit=10 candidates
// this staggers the whole batch over ~40s rather than firing all 10 OpenRouter
// calls simultaneously -- the concern that scales badly at 1,000 candidates,
// not 10, but the pacing mechanism has to exist before the volume does.
const STAGGER_MS = 4_000;
// Maximum remediation attempts per analysis. Rows landing in StillPartial
// increment a retry counter; once they hit this cap, they're excluded from
// future sweeps to prevent unbounded LLM billing on persistently failing rows.
const MAX_REMEDIATION_RETRIES = 3;

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

/** Narrow an unknown jsonb value to a plain object, or {} for null/array/primitive. Shared by every read site that treats validation_report as a spreadable base. */
function asReportObject(report: unknown): Record<string, unknown> {
  return report && typeof report === 'object' && !Array.isArray(report) ? (report as Record<string, unknown>) : {};
}

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
  const limit = opts?.limit ?? 3;
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
    const reportObj = asReportObject(report);
    const reportMetadata = reportObj.metadata as Record<string, unknown> | undefined;

    // Exclude rows that have exceeded the retry limit to prevent unbounded
    // LLM billing on persistently failing analyses
    const retryCount = typeof reportObj.remediation_retry_count === 'number' ? reportObj.remediation_retry_count : 0;
    if (retryCount >= MAX_REMEDIATION_RETRIES) continue;

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
 * Consume the worker's SSE stream server-side (no browser present in a cron
 * context) and accumulate the JSON fragments into one chunk-shaped payload,
 * matching what a single bundle stream produces for stitchChunksIntoPayload.
 *
 * Framing matches web/hooks/useSSEStream.ts's browser-side reader exactly
 * (split on blank-line-delimited SSE events, not raw `\n`) so the two stay
 * in sync with the wire format the worker actually emits
 * (`data: {...}\n\n`, worker/src/routes/analysis.ts). Kept as a separate,
 * server-only implementation rather than importing the browser hook
 * directly -- useSSEStream.ts is coupled to React state/AbortSignal/adapter
 * callbacks that don't apply in a cron context -- but a shared
 * `parseSSEStream(response, onEvent)` extraction is the deeper fix if a
 * third consumer of this exact framing ever shows up.
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

  // Stratified dual-timeout architecture (CLAUDE.md Law #2):
  // - Connection handshake: 3-second hard timeout
  // - Token streaming window: 90-second maximum read (Worker budget)
  const CONNECTION_TIMEOUT_MS = 3_000;
  const STREAMING_TIMEOUT_MS = 90_000;
  const abortController = new AbortController();

  // Connection timeout aborts stalled handshakes
  let connectionTimeoutId: NodeJS.Timeout | null = setTimeout(
    () => abortController.abort(),
    CONNECTION_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(`${env.cloudflareWorkerUrl}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (err) {
    if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error('[dimension-remediation] worker call threw', { analysisId: gap.id, isTimeout, err: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, {
      contexts: {
        remediation: {
          service: 'dimension-remediation',
          phase: 'worker_call',
          timeout: String(isTimeout),
          analysisId: gap.id,
        },
      },
    });
    return null;
  }

  // Clear connection timeout and replace with streaming timeout
  if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
  connectionTimeoutId = null;
  const streamingTimeoutId = setTimeout(
    () => abortController.abort(),
    STREAMING_TIMEOUT_MS
  );

  if (!res.ok || !res.body) {
    clearTimeout(streamingTimeoutId);
    const errText = await res.text().catch(() => '');
    console.error('[dimension-remediation] worker call failed', { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) });
    Sentry.captureMessage('dimension-remediation: worker non-2xx response', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id, status: res.status, errText: errText.slice(0, 500) } },
    });
    return null;
  }

  try {
    return await readAndMergeWorkerStream(res.body, gap);
  } finally {
    clearTimeout(streamingTimeoutId);
  }
}

/**
 * Reads the worker's SSE response body and merges its fragments into one
 * chunk-shaped object. Split out of collectDimensionsFromWorker so that
 * function stays to request-construction + fetch-with-timeout, and this one
 * owns only stream decoding/merging -- CodeFactor flagged the unsplit
 * version as high-complexity, and the two concerns (network call lifecycle
 * vs. wire-format parsing) were genuinely separable, not artificially split.
 *
 * Field mapping here MUST match UCISStreamFragmentSchema
 * (web/lib/validators/synthesis.ts) exactly -- the wire shape is NOT the
 * same as UCISPayloadV2's persisted shape. A dimension fragment carries the
 * dimension NUMBER in a field literally named `dimension` plus separate
 * `name`/`content` fields -- stitchChunksIntoPayload needs a dimension
 * OBJECT ({number, name, content}), so it has to be reassembled here, not
 * passed through as the bare number. persona's payload field is `config`,
 * classification's is `data`, and knowledge graph arrives as `kg` with
 * top-level `nodes`/`edges`/`rootId` (not a nested `knowledgeGraph` object).
 * There is no `monetizationVerdict` stream fragment type at all -- it's a
 * UCISPayloadV2 persisted-payload field, never emitted on the wire, so
 * there is nothing to merge from a fresh worker call.
 */
async function readAndMergeWorkerStream(body: ReadableStream<Uint8Array>, gap: AnalysisGap): Promise<Record<string, unknown> | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let skippedFragmentCount = 0;
  const chunk: Record<string, unknown> = { dimensions: [] as unknown[] };

  const mergeFragment = (frag: Record<string, unknown>) => {
    if (frag.type === 'dimension' && typeof frag.dimension === 'number' && typeof frag.content === 'string') {
      (chunk.dimensions as unknown[]).push({ number: frag.dimension, name: frag.name ?? `Dimension ${frag.dimension}`, content: frag.content });
    } else if (frag.type === 'persona' && frag.config) {
      chunk.persona = frag.config;
    } else if (frag.type === 'classification' && frag.data) {
      chunk.classification = frag.data;
    } else if (frag.type === 'kg' && Array.isArray(frag.nodes)) {
      chunk.knowledgeGraph = { nodes: frag.nodes, edges: frag.edges ?? [], rootId: frag.rootId ?? null };
    }
  };

  const handleEvent = (rawEvent: string) => {
    const trimmed = rawEvent.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') return;
    try {
      mergeFragment(JSON.parse(jsonStr));
    } catch (parseErr) {
      skippedFragmentCount++;
      console.warn('[dimension-remediation] unparseable SSE fragment, skipping', { analysisId: gap.id, err: parseErr instanceof Error ? parseErr.message : String(parseErr) });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) handleEvent(event);
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error('[dimension-remediation] SSE read aborted or failed', { analysisId: gap.id, isTimeout, err: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, {
      contexts: {
        remediation: {
          service: 'dimension-remediation',
          phase: 'sse_read',
          timeout: String(isTimeout),
          analysisId: gap.id,
        },
      },
    });
    return null;
  }

  if (skippedFragmentCount > 0) {
    console.warn('[dimension-remediation] some SSE fragments were unparseable', { analysisId: gap.id, skippedFragmentCount });
    Sentry.captureMessage('dimension-remediation: unparseable SSE fragments', {
      level: 'warning',
      contexts: {
        remediation: {
          analysisId: gap.id,
          skippedFragmentCount,
        },
      },
    });
  }

  return (chunk.dimensions as unknown[]).length > 0 ? chunk : null;
}

/**
 * Remediate a single gap: call the worker for just the missing dimensions,
 * stitch the result in with the existing content, persist if it actually
 * improved the analysis. The final write is guarded on
 * `billing_status = 'failed'` so a concurrent legitimate "Re-analyze" (which
 * would move the row to `processing` then `completed`) always wins -- this
 * is the sole race guard; see the module doc for why a separate per-row
 * claim was removed as redundant with it under the run-level lock.
 */
export async function remediateAnalysis(
  gap: AnalysisGap,
  models: string[],
  cascade: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>
): Promise<RemediationResult> {
  const persistenceAdapter = new SupabasePersistenceAdapter();

  const newChunk = await collectDimensionsFromWorker(gap, models, cascade);
  if (!newChunk) {
    return { analysisId: gap.id, stage: RemediationStage.WorkerFailed, dimensionsRequested: gap.missingDimensions };
  }

  // Existing content, wrapped as a "chunk" so stitchChunksIntoPayload's
  // existing merge-by-map logic can combine it with the newly-generated one
  // without any new merge code. The map keys (1, 2) aren't dimension
  // numbers -- they're arbitrary chunk-slot indices, same as bundle-stream
  // indices are in the live 5-way merge; stitchChunksIntoPayload only ever
  // iterates 1..resolvedTotal to visit each slot once.
  const EXISTING_SLOT = 1;
  const NEW_SLOT = 2;
  const existingChunk: Record<string, unknown> = gap.analysisPayload
    ? gap.analysisPayload
    : { dimensions: Object.values(parseToUCISDimensions(gap.analysisMarkdown)) };

  const chunkMap = new Map<number, unknown>([
    [EXISTING_SLOT, existingChunk],
    [NEW_SLOT, newChunk],
  ]);
  const stitchResult = stitchChunksIntoPayload(chunkMap, 2);
  if (!stitchResult.payload) {
    Sentry.captureMessage('dimension-remediation: stitch produced no payload', {
      level: 'error',
      contexts: { remediation: { analysisId: gap.id } },
    });
    return { analysisId: gap.id, stage: RemediationStage.StitchFailed, dimensionsRequested: gap.missingDimensions };
  }

  const { dimensionStatus, validationStatus, billingStatus } = buildDimensionStatus(stitchResult.payload);
  const dimensionCountAfter = dimensionStatus.filter((d) => d.status === 'done').length;
  const nowIso = new Date().toISOString();
  const isStillPartial = dimensionCountAfter < TOTAL_DIMENSIONS;
  const existingReport = asReportObject(gap.validationReport);
  const currentRetryCount = typeof existingReport.remediation_retry_count === 'number' ? existingReport.remediation_retry_count : 0;

  const newReport = {
    ...existingReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    remediated: true,
    remediated_at: nowIso,
    remediated_dimensions: gap.missingDimensions,
    // Increment retry counter only if still partial, to bound retries on
    // persistently failing rows
    remediation_retry_count: isStillPartial ? currentRetryCount + 1 : currentRetryCount,
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
    // "Re-analyze" that moved the row off billing_status='failed' since this
    // gap was found). The row is no longer a remediation candidate -- nothing
    // to retry.
    return { analysisId: gap.id, stage: RemediationStage.PersistRaced, dimensionsRequested: gap.missingDimensions };
  }

  return {
    analysisId: gap.id,
    stage: dimensionCountAfter >= TOTAL_DIMENSIONS ? RemediationStage.Remediated : RemediationStage.StillPartial,
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
 *    same candidates (and, since each candidate fires a real paid worker
 *    call, double-paying for it). This is the ONLY overlap guard -- see the
 *    module doc for why a second per-row claim was removed as redundant.
 * 2. Staggered pacing (STAGGER_MS between candidates): candidates are
 *    processed sequentially, not via Promise.all, specifically so this
 *    doesn't fire N simultaneous OpenRouter calls. At limit=10 this is
 *    already true by construction (a plain for-loop is sequential), but the
 *    delay is explicit so the pacing is a real, tunable property of the
 *    harness rather than an accident of not having parallelized yet -- the
 *    thing to widen if a future limit=1000 needs batched concurrency instead
 *    of pure sequential staggering.
 *
 * The model cascade is resolved once per harness run, not once per
 * candidate -- it doesn't vary within a run, so resolving it inside the
 * per-candidate path would just be N redundant identical config reads.
 */
export async function runRemediationHarness(opts?: { limit?: number }): Promise<RemediationSweepResult> {
  const lockToken = await acquireRedisLock(HARNESS_LOCK_KEY, HARNESS_LOCK_TTL_SECONDS);
  if (!lockToken) {
    console.log('[dimension-remediation] harness already running, skipping this tick', { lockKey: HARNESS_LOCK_KEY });
    return { scanned: 0, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, lockHeld: false };
  }

  try {
    const gaps = await findAnalysesWithMissingDimensions(opts);
    const result: RemediationSweepResult = { scanned: gaps.length, remediated: 0, stillPartial: 0, skipped: 0, errored: 0, lockHeld: true };
    if (gaps.length === 0) return result;

    const cascade = await resolveAnalysisCascade();
    const models = cascade.map((c) => c.model);

    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i]!;
      try {
        const outcome = await remediateAnalysis(gap, models, cascade);
        console.log('[dimension-remediation] candidate processed', { analysisId: gap.id, stage: outcome.stage });
        switch (outcome.stage) {
          case RemediationStage.Remediated:
            result.remediated++;
            break;
          case RemediationStage.StillPartial:
            result.stillPartial++;
            break;
          case RemediationStage.PersistRaced:
            result.skipped++;
            break;
          default:
            result.errored++;
        }
      } catch (err) {
        Sentry.captureException(err, {
          contexts: {
            remediation: {
              service: 'dimension-remediation',
              analysisId: gap.id,
            },
          },
        });
        result.errored++;
      }

      if (i < gaps.length - 1) {
        await sleep(STAGGER_MS);
      }
    }
    return result;
  } finally {
    await releaseRedisLock(HARNESS_LOCK_KEY, lockToken);
  }
}
