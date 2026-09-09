/**
 * Analysis Reaper (ADR 007 — Persistence lifecycle recovery)
 *
 * A YouTube analysis streams browser ↔ Cloudflare Worker; the Worker persists
 * the final row with `billing_status = 'completed'` via `waitUntil` when the
 * stream settles. If the Worker times out, the client disconnects, or the
 * process is reclaimed before that settle runs, the row is orphaned in
 * `billing_status = 'processing'` forever — it then shows up in history as a
 * permanent "processing" ghost with no output.
 *
 * The reaper is the safety net: on a schedule (QStash cron → /api/webhooks/reaper)
 * it sweeps rows stuck in `processing` past a grace window and settles each to a
 * terminal state — salvaging any that already have enough generated content,
 * failing the rest. It is idempotent (single-winner UPDATE guarded on
 * `billing_status = 'processing'`) so a legitimately-late settle always wins.
 */
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { countUcisDimensions } from '@/lib/utils/count-ucis-dimensions';
import { TOTAL_DIMENSIONS, TOTAL_STREAMS, MIN_USABLE_DIMENSIONS } from '@/lib/config/synthesis';
import { stitchChunksIntoPayload, buildDimensionStatus, extractDimensionStatus } from '@/lib/services/stitch-analysis-chunks';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
// ADR 021 Phase 3 — the requeue-partial middle branch lives in its sibling
// module (same "kept as a sibling, not merged" split dimension-remediation.ts
// documents); the reaper owns terminal settlement, the sibling owns the
// non-terminal requeue bookkeeping.
import { REMEDIATION_MAX_RETRIES_FALLBACK, tryRequeuePartial } from '@/lib/services/analysis-requeue';
import type { ReapOutcome, SettlePatch } from '@/lib/services/analysis-requeue';
import type { BillingStatus, ValidationReportStatus, DimensionStatus } from '@/lib/types/validation-report';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';

// Back-compat re-exports: the requeue-partial outcome and the shared patch
// shape are part of this module's public surface (existing consumers import
// them from here).
export type { ReapOutcome, SettlePatch } from '@/lib/services/analysis-requeue';

/**
 * Minimum dimensions for a partial analysis to be salvaged as `completed`.
 * Re-exports the single-source `MIN_USABLE_DIMENSIONS` so the reaper and the
 * cache read path (SupabaseAnalysisAdapter) can never disagree on what counts
 * as a usable analysis.
 */
export const MIN_SALVAGEABLE_DIMENSIONS = MIN_USABLE_DIMENSIONS;

/**
 * A `processing` row is only reaped once it is older than this. The Worker's
 * whole budget (≈58s stream + 15s persist timeout) is well under this, so any
 * legitimately in-flight analysis is never prematurely failed.
 */
export const REAP_GRACE_MINUTES = 30;

/**
 * Small bounded retry for the recovery write path -- mirrors the same
 * exponential-backoff pattern persist/route.ts already uses for its own
 * Supabase writes (retryWithBackoff there), duplicated locally rather than
 * imported since that one is a route-local helper, not a shared module.
 * A transient failure here must not throw away an otherwise-successful
 * salvage: on exhaustion it rethrows so the caller's existing try/catch
 * (in sweepStuckAnalyses) falls through to the markdown-based path exactly
 * as it already does for any other chunk-recovery failure.
 */
const retryWithBackoff = async <T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
  }
  throw lastError;
};

/**
 * Pure decision — given a stuck row's markdown, decide salvage-vs-fail and
 * report the derived dimension count. Exported for unit testing.
 *
 * Return type is deliberately the narrow terminal subset of ReapOutcome: the
 * markdown alone can never justify a requeue (requeue needs per-chunk
 * checkpoint data + the retry count, neither of which lives in the markdown).
 * The requeue-partial branch is decided by analysis-requeue.ts's
 * decideRequeuePartial, fed by analysis_chunks — keeping the two decisions'
 * data sources separate means no consumer of this function can silently fall
 * through requeue-partial to a terminal state at the type level.
 */
export function decideReapOutcome(analysisMarkdown: string | null | undefined): {
  outcome: Exclude<ReapOutcome, 'requeue-partial'>;
  dimensionCount: number;
} {
  // Count across BOTH persisted formats (```json-fenced payload and stitched
  // "### DIMENSION" markdown) — the markdown-only parser returned 0 for JSON
  // rows, which failed salvageable analyses.
  const dimensionCount = countUcisDimensions(analysisMarkdown);
  return {
    outcome: dimensionCount >= MIN_SALVAGEABLE_DIMENSIONS ? 'completed' : 'failed',
    dimensionCount,
  };
}

export interface SweepResult {
  scanned: number;
  completed: number;
  failed: number;
  /** ADR 021 Phase 3: rows requeued as partial-and-retryable (NOT settled — still `processing`). */
  requeued: number;
  raced: number; // rows a concurrent settle won before us
}

interface StuckRow {
  id: string;
  analysis_markdown: string | null;
  validation_report: Record<string, unknown> | null;
}

/**
 * Build the terminal-state row patch for a stuck analysis (pure — no I/O).
 * Salvages a full analysis as complete, a usable partial as partial, and
 * anything below the threshold as failed; preserves the prior report fields.
 * Exported for unit testing.
 *
 * Maps ReapOutcome to BillingStatus:
 * - 'completed' (enough dimensions salvaged) → 'completed'
 * - 'failed' (below minimum) → 'failed' (no charge)
 *
 * RCA (2026-07-23): this used to map to 'chargeable', which the DB's CHECK
 * constraint (processing|completed|failed) has always rejected. See
 * BillingStatus type for the full RCA -- this is the same bug the chunk-
 * recovery path below was built to route around, just on the reaper's
 * older markdown-only path.
 */
export function buildSettlePatch(
  analysisMarkdown: string | null | undefined,
  existingReport: unknown,
  nowIso: string = new Date().toISOString(),
): { outcome: ReapOutcome; patch: SettlePatch } {
  const { outcome, dimensionCount } = decideReapOutcome(analysisMarkdown);
  const isComplete = outcome === 'completed' && dimensionCount >= TOTAL_DIMENSIONS;
  const reportStatus = outcome === 'failed' ? 'failed' : isComplete ? 'complete' : 'partial';

  // Map ReapOutcome to valid BillingStatus enum values
  const billingStatus = outcome === 'completed' ? 'completed' : 'failed';

  // jsonb can decode to an array/scalar too; only spread a plain object so the
  // report shape stays consistent.
  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  return {
    outcome,
    patch: {
      billing_status: billingStatus,
      validation_passed: isComplete,
      validation_report: { ...baseReport, status: reportStatus, reaped: true, reaped_at: nowIso, reaped_dimensions: dimensionCount },
      updated_at: nowIso,
    },
  };
}

export interface ChunkRow {
  chunk_index: number;
  payload: Record<string, unknown> | null;
  status: string;
}

/**
 * Checks whether every expected bundle-stream chunk (1..TOTAL_STREAMS) is
 * present, `status === 'completed'`, and carries a `dimensions` array --
 * mirroring persist/route.ts's own "CONTRACT VALIDATION" check, so the
 * reaper never treats a genuinely partial/interrupted set as recoverable.
 * Exported for unit testing.
 */
export function chunksAreFullyComplete(chunkRows: ChunkRow[]): boolean {
  if (chunkRows.length !== TOTAL_STREAMS) return false;
  const byIndex = new Map(chunkRows.map(c => [c.chunk_index, c]));
  for (let i = 1; i <= TOTAL_STREAMS; i++) {
    const c = byIndex.get(i);
    if (!c || c.status !== 'completed') return false;
    if (!c.payload || !Array.isArray((c.payload as { dimensions?: unknown }).dimensions)) return false;
  }
  return true;
}

/**
 * Decide the salvage report fields for a stitched chunk-recovery payload.
 * Extracted from tryChunkRecovery purely to keep that function's cyclomatic
 * complexity down (DeepSource flagged 19/"high risk" pre-extraction) -- the
 * two branches are the two distinct policies described where this is called
 * from: strict 100%-or-failed for a full chunk set, threshold-based salvage
 * for a partial one.
 */
function decideChunkSalvagePolicy(
  stitchedPayload: UCISPayloadV2,
  isFullSet: boolean,
  dimensionCount: number,
): { dimensionStatus: DimensionStatus[]; validationStatus: ValidationReportStatus; billingStatus: BillingStatus } {
  if (isFullSet) return buildDimensionStatus(stitchedPayload);
  return {
    dimensionStatus: extractDimensionStatus(stitchedPayload),
    validationStatus: dimensionCount >= TOTAL_DIMENSIONS ? 'done' : 'partial',
    billingStatus: dimensionCount >= MIN_SALVAGEABLE_DIMENSIONS ? 'completed' : 'failed',
  };
}

/**
 * Attempts chunk-based recovery for a single stuck row: if every bundle-
 * stream chunk is present and complete in `analysis_chunks` (the row was
 * fully generated, but the parent row's own finalize/stitch write was
 * interrupted -- e.g. a transient timeout -- before it could commit), re-run
 * the EXACT same stitching/validation/normalization the live persist route
 * uses (shared module, not a re-implementation) and finalize properly,
 * instead of falling through to the markdown-only salvage heuristic below
 * (which would see an empty analysis_markdown and wrongly discard a
 * genuinely complete analysis as unsalvageable).
 *
 * RCA (2026-08-02, live production, video LTNVA2iP9YU): one of the 5 parallel
 * bundle-stream requests (chunk 2) returned HTTP 200 to the browser but its
 * worker-side `atomicPersist`/`persistAnalysisChunk` call never landed a row
 * in `analysis_chunks` -- the browser never logged a "[Bundle 2] completed"
 * nor an error event for it either (a separate, real client-side bug fixed
 * alongside this one; see useSSEStream.ts). Server-side, this left the row
 * stuck in `processing` with 4/5 chunks (10/11 dimensions) genuinely
 * complete in `analysis_chunks`. Because `chunksAreFullyComplete` required
 * all 5, the ORIGINAL version of this function returned null unconditionally
 * on any incompleteness, falling through to the markdown-based salvage path
 * below -- but `analysis_markdown` is NEVER populated for chunked analyses
 * until the final stitch commits, so that path saw 0 dimensions and reaped
 * the row as `failed` with nothing, discarding 10 genuinely-complete
 * dimensions sitting right there in `analysis_chunks`. This partial-recovery
 * branch mirrors `decideReapOutcome`'s existing MIN_SALVAGEABLE_DIMENSIONS
 * threshold (the same policy the markdown path already uses for a "usable
 * partial") so a majority-complete chunk set is salvaged into the row's own
 * markdown/payload instead of being silently thrown away.
 *
 * Returns null when there is nothing worth salvaging (no completed chunks,
 * or a completed set below MIN_SALVAGEABLE_DIMENSIONS), or when the recovery
 * attempt itself fails for any reason -- the caller falls through to the
 * existing markdown-based decision in all cases, so this path can only ever
 * ADD a recovery option, never take one away.
 */
export async function tryChunkRecovery(
  analysisId: string,
  existingReport: unknown,
  persistenceAdapter: SupabasePersistenceAdapter
): Promise<{ outcome: Exclude<ReapOutcome, 'requeue-partial'> } | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('analysis_chunks')
    .select('chunk_index, payload, status')
    .eq('analysis_id', analysisId);
  if (error) throw error;

  const chunkRows = (data ?? []) as ChunkRow[];
  const isFullSet = chunksAreFullyComplete(chunkRows);

  // Partial set: only feed chunks that individually completed with a valid
  // dimensions array into the stitch -- a chunk row that exists but never
  // reached `status === 'completed'` (or lacks a dimensions array) carries no
  // trustworthy content and must not be mixed into the salvage.
  const usableRows = isFullSet
    ? chunkRows
    : chunkRows.filter(
        c => c.status === 'completed' && Array.isArray((c.payload as { dimensions?: unknown } | null)?.dimensions)
      );
  if (usableRows.length === 0) return null;

  const chunkMap = new Map<number, any>(usableRows.map(c => [c.chunk_index, c.payload]));
  const stitchResult = stitchChunksIntoPayload(chunkMap, TOTAL_STREAMS);
  if (!stitchResult.payload) return null;

  const dimensionCount = stitchResult.payload.dimensions?.length ?? 0;
  // Below salvage threshold: not enough content to be worth anything -- fall
  // through to the markdown-based path, which will (correctly) also fail the
  // row since analysis_markdown was never populated for chunked analyses.
  if (!isFullSet && dimensionCount < MIN_SALVAGEABLE_DIMENSIONS) return null;

  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  const nowIso = new Date().toISOString();

  // Full set: keep the existing strict "100% or it doesn't bill" policy.
  // Partial set: mirror decideReapOutcome's own MIN_SALVAGEABLE_DIMENSIONS
  // threshold -- the same policy this reaper already applies on the
  // markdown-only path -- so the two salvage paths don't silently disagree
  // on what counts as a usable partial.
  const { dimensionStatus, validationStatus, billingStatus } = decideChunkSalvagePolicy(
    stitchResult.payload,
    isFullSet,
    dimensionCount,
  );

  const newReport = {
    ...baseReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    reaped: true,
    reaped_via: isFullSet ? 'chunk_recovery' : 'chunk_recovery_partial',
    reaped_at: nowIso,
    reaped_dimensions: dimensionCount,
  };

  // Guarded: only commits if this row is STILL `processing` -- same
  // single-winner race protection as the markdown-based path below, reused
  // (not re-implemented) via updateAnalysisResult's guardBillingStatus.
  const { updated } = await retryWithBackoff(() =>
    persistenceAdapter.updateAnalysisResult({
      analysisId,
      markdown: stitchResult.markdown,
      payload: stitchResult.payload ?? null,
      model: null,
      validationPassed: stitchResult.validationPassed,
      validationReport: newReport,
      guardBillingStatus: 'processing',
    })
  );
  if (!updated) return null; // raced -- a concurrent legitimate settle won; caller treats this row as "handled"

  return { outcome: billingStatus === 'completed' ? 'completed' : 'failed' };
}

/**
 * Sweep and settle stuck `processing` analyses. Safe to run repeatedly.
 */
export async function sweepStuckAnalyses(opts?: { graceMinutes?: number; limit?: number }): Promise<SweepResult> {
  const graceMinutes = opts?.graceMinutes ?? REAP_GRACE_MINUTES;
  const limit = opts?.limit ?? 500;
  const service = getSupabaseServiceClient();
  const persistenceAdapter = new SupabasePersistenceAdapter();
  const cutoffIso = new Date(Date.now() - graceMinutes * 60_000).toISOString();

  const { data, error } = await service
    .from('analyses')
    .select('id, analysis_markdown, validation_report')
    .eq('billing_status', 'processing')
    .lt('created_at', cutoffIso)
    .limit(limit);
  if (error) throw error;

  const stuck = (data ?? []) as StuckRow[];
  const result: SweepResult = { scanned: stuck.length, completed: 0, failed: 0, requeued: 0, raced: 0 };

  // `remediation.maxRetries` (the shared requeue/remediation ceiling) is
  // resolved at most once per sweep, and only if some row actually needs it —
  // the same "resolve once per run" convention the remediation harness applies
  // to its cascade/budget resolution.
  let maxRetriesCache: number | null = null;
  /** Resolves and memoizes `remediation.maxRetries` for this sweep run (see comment above). */
  const resolveMaxRetries = async (): Promise<number> => {
    if (maxRetriesCache === null) {
      const settings = await SupabaseSettingsAdapter.getRegistrySettings(
        ['remediation.maxRetries'],
        { 'remediation.maxRetries': REMEDIATION_MAX_RETRIES_FALLBACK }
      );
      maxRetriesCache = Number(settings['remediation.maxRetries']) || REMEDIATION_MAX_RETRIES_FALLBACK;
    }
    return maxRetriesCache;
  };

  /**
   * ADR 021 Phase 3 wrapper: attempt a requeue-partial for one stuck row,
   * swallowing (and Sentry-capturing) any failure into a null "not eligible,
   * fall through to the existing terminal settle" result -- extracted out of
   * the sweep loop's own body purely to keep that loop's own branch count
   * down (CodeFactor "Complex Method"), no behavior change from inlining it.
   */
  const attemptRequeue = async (row: StuckRow, maxRetries: number): Promise<'requeued' | 'raced' | null> => {
    try {
      return await tryRequeuePartial(row, persistenceAdapter, maxRetries);
    } catch (requeueErr) {
      Sentry.captureException(requeueErr, {
        tags: { service: 'analysis-reaper', phase: 'requeue_partial' },
        extra: { analysisId: row.id },
      });
      return null;
    }
  };

  /**
   * Chunk-based recovery is tried FIRST for every stuck row and is strictly
   * additive: any exception, or chunks not fully complete, or a lost
   * concurrent race, all collapse to null here so the caller falls through
   * to the exact same markdown-based path this reaper always used -- never
   * a behavior regression, only a new way to correctly recover a case the
   * old path would have discarded. Extracted purely to keep the sweep
   * loop's own branch count down (CodeFactor "Complex Method").
   */
  const attemptChunkRecovery = async (
    row: StuckRow,
  ): Promise<{ outcome: Exclude<ReapOutcome, 'requeue-partial'> } | null> => {
    try {
      return await tryChunkRecovery(row.id, row.validation_report, persistenceAdapter);
    } catch (chunkErr) {
      Sentry.captureException(chunkErr, {
        tags: { service: 'analysis-reaper', phase: 'chunk_recovery' },
        extra: { analysisId: row.id },
      });
      return null;
    }
  };

  for (const row of stuck) {
    const recovered = await attemptChunkRecovery(row);
    if (recovered) {
      if (recovered.outcome === 'completed') result.completed++;
      else result.failed++;
      continue;
    }

    const { outcome, patch } = buildSettlePatch(row.analysis_markdown, row.validation_report);

    // ADR 021 Phase 3 — requeue-partial middle branch, evaluated only for a
    // row the markdown path would fail: it may still hold genuinely-persisted
    // dimensions in analysis_chunks (Phase 1's checkpoint) that the
    // markdown-only decision cannot see. Strictly additive — 0-covered and
    // ceiling-hit rows return null and fall through to the EXISTING failed
    // settle unchanged, same philosophy as chunk recovery above.
    if (outcome === 'failed') {
      const requeued = await attemptRequeue(row, await resolveMaxRetries());
      if (requeued === 'requeued') {
        result.requeued++;
        continue;
      }
      if (requeued === 'raced') {
        result.raced++;
        continue;
      }
      // null → not a requeue candidate; fall through to the existing failed settle
    }

    // Single-winner UPDATE: only mutate rows STILL `processing`, so a concurrent
    // legitimate settle (which also writes billing_status) wins the race and we
    // never clobber a real completion.
    const { error: updErr, count } = await service
      .from('analyses')
      .update(patch, { count: 'exact' })
      .eq('id', row.id)
      .eq('billing_status', 'processing');

    if (updErr) {
      Sentry.captureException(updErr, { tags: { service: 'analysis-reaper' }, extra: { analysisId: row.id } });
      continue;
    }
    if (!count) {
      result.raced++;
      continue;
    }
    if (outcome === 'completed') result.completed++;
    else result.failed++;
  }

  return result;
}
