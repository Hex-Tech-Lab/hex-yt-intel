/**
 * Analysis Requeue (ADR 021 Phase 3 — reaper requeue-partial extension)
 *
 * Sibling service to analysis-reaper.ts (same "kept as a sibling, not merged"
 * split dimension-remediation.ts documents): the reaper owns TERMINAL
 * settlement of stuck `processing` rows (finalize vs. discard, ADR 007);
 * this module owns the NON-terminal middle branch ADR 021 Phase 3 added —
 * when a stuck row the markdown path would fail still holds genuinely
 * persisted dimensions in `analysis_chunks` (Phase 1's `dimensions_covered`
 * checkpoint), the row can be REQUEUED instead: left in `processing` with
 * its missing dimensions recorded and one shared remediation retry burned,
 * so a later sweep re-evaluates it and a future Phase 4 selective client
 * dispatch (useSSEStream.ts) can consume the recorded state.
 *
 * This module never triggers regeneration itself — no LLM/worker calls, no
 * billing_status change to provoke a client retry. Recording the state IS
 * the deliverable; wiring the retry is Phase 4's scope.
 */
import { TOTAL_DIMENSIONS, MIN_USABLE_DIMENSIONS } from '@/lib/config/synthesis';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { getSupabaseServiceClient } from '@/lib/supabase';

/** Same single-source threshold the reaper's salvage path uses. */
export const MIN_SALVAGEABLE_DIMENSIONS = MIN_USABLE_DIMENSIONS;

/**
 * ADR 021 Phase 3: 'requeue-partial' joins the two terminal outcomes. It is
 * NOT terminal — the row stays `processing` (sweepable) with its missing
 * dimensions recorded and a remediation retry burned; a later sweep
 * re-evaluates it (and a future Phase 4 client dispatch consumes the
 * recorded state).
 */
export type ReapOutcome = 'completed' | 'failed' | 'requeue-partial';

export interface SettlePatch {
  billing_status: import('@/lib/types/validation-report').BillingStatus;
  validation_passed: boolean;
  validation_report: Record<string, unknown>;
  updated_at: string;
}

/**
 * Fallback for the `remediation.maxRetries` Settings Registry key when the
 * registry itself is unreachable — mirrors dimension-remediation.ts's
 * REGISTRY_FALLBACK (both must stay in sync with migration
 * 20260731000000_remediation_budget_settings.sql's seeded default of 3).
 * Kept local rather than imported to avoid dragging that module's heavier
 * dependency graph (redis/stream-token/env) into the reaper's; the registry
 * read is the source of truth at runtime, this only bounds a registry outage.
 */
export const REMEDIATION_MAX_RETRIES_FALLBACK = 3;

/** Dimension numbers in [1..TOTAL_DIMENSIONS] not present in `covered`. */
// skipcq: JS-0067
function missingFrom(covered: Set<number>): number[] {
  return Array.from({ length: TOTAL_DIMENSIONS }, (_unused, i) => i + 1).filter((dimension) => !covered.has(dimension));
}

/** True when a stuck row's covered-dimension count qualifies for requeue-partial (see decideRequeuePartial). */
// skipcq: JS-0067
function isRequeueEligible(coveredCount: number, currentRetryCount: number, maxRetries: number): boolean {
  return coveredCount > 0 && coveredCount < MIN_SALVAGEABLE_DIMENSIONS && currentRetryCount < maxRetries;
}

/**
 * ADR 021 Phase 3 — the requeue-partial middle branch, decided BEFORE a stuck
 * row is discarded by the markdown path. Same binary salvage logic the reaper
 * already applies (ADR 021: "the existing binary reaper decision, just
 * evaluated per dimension"), evaluated against the per-chunk dimension
 * checkpoint (`analysis_chunks.dimensions_covered`, Phase 1) instead of the
 * markdown:
 *
 * - 0 dimensions covered → null (nothing persisted; the existing
 *   `'failed'`/discard path is correct — unchanged behavior).
 * - ≥ MIN_SALVAGEABLE_DIMENSIONS covered → null (tryChunkRecovery already
 *   owns salvage-at-threshold; callers only reach here when it fell through).
 * - 1..MIN-1 covered AND retry count below the ceiling → `'requeue-partial'`
 *   with the exact missing dimension numbers.
 * - Ceiling hit → null (a permanently-broken piece must stop being requeued,
 *   per ADR 021's retry-ceiling guardrail; reuses the existing
 *   `remediation.maxRetries` / `remediation_retry_count` — no new mechanism).
 *
 * `coveredDimensions` must be the union of `dimensions_covered` from chunks
 * passing the same trust rule tryChunkRecovery's usableRows applies (see
 * tryRequeuePartial) — that keeps this branch provably consistent with the
 * salvage path: any dimension counted here is one tryChunkRecovery would
 * have stitched and salvaged had the union reached the threshold.
 *
 * Pure. Exported for unit testing (same pattern as decideReapOutcome).
 */
export const decideRequeuePartial = (
  coveredDimensions: number[],
  currentRetryCount: number,
  maxRetries: number,
): { outcome: Extract<ReapOutcome, 'requeue-partial'>; missingDimensions: number[] } | null => {
  const covered = new Set(coveredDimensions.filter(dim => Number.isInteger(dim) && dim >= 1 && dim <= TOTAL_DIMENSIONS));
  if (!isRequeueEligible(covered.size, currentRetryCount, maxRetries)) return null;
  return { outcome: 'requeue-partial', missingDimensions: missingFrom(covered) };
};

/**
 * Build the requeue bookkeeping patch for a stuck-partial row (pure — no
 * I/O). Mirrors buildSettlePatch's exact SettlePatch shape for consistency —
 * the ONLY semantic difference is the state it leaves behind:
 *
 * - `billing_status` stays `'processing'`: a requeue is not a settle. The row
 *   must remain in the sweepable state so a later sweep re-evaluates it (and
 *   so the future Phase 4 selective client dispatch can consume the recorded
 *   missing-dimensions state). The refresh to `updated_at` doubles as a fresh
 *   lease for the client staleness clock (which keys off updated_at).
 * - `validation_report` is NOT marked `reaped` (nothing was settled); it
 *   records `requeue_partial: true`, the specific `requeue_missing_dimensions`,
 *   `requeued_at`, and the incremented `remediation_retry_count` — the same
 *   shared counter the dimension-remediation harness reads/enforces its
 *   ceiling against (ADR 021 open-question 4 resolution: one shared counter,
 *   no new field).
 *
 * Exported for unit testing.
 */
export const buildRequeuePatch = (
  missingDimensions: number[],
  existingReport: unknown,
  nextRetryCount: number,
  nowIso: string = new Date().toISOString(),
): { outcome: Extract<ReapOutcome, 'requeue-partial'>; patch: SettlePatch } => {
  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  return {
    outcome: 'requeue-partial',
    patch: {
      billing_status: 'processing',
      validation_passed: false,
      validation_report: {
        ...baseReport,
        status: 'partial',
        requeue_partial: true,
        requeue_missing_dimensions: missingDimensions,
        requeued_at: nowIso,
        remediation_retry_count: nextRetryCount,
      },
      updated_at: nowIso,
    },
  };
};

/**
 * The shared retry counter (ADR 021 open-question 4: reuse
 * `remediation_retry_count`, no new field) — read the same way
 * dimension-remediation.ts reads it, so the reaper's requeues and the
 * remediation harness's attempts draw down ONE shared ceiling.
 */
// skipcq: JS-0067
function readRemediationRetryCount(existingReport: unknown): number {
  const report =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  return typeof report.remediation_retry_count === 'number' ? report.remediation_retry_count : 0;
}

/**
 * ADR 021 Phase 3 I/O wrapper around decideRequeuePartial: reads the row's
 * chunk checkpoint via the EXISTING port method (findAnalysisChunks — no
 * parallel query for the same data), decides, and on a positive decision
 * commits the requeue bookkeeping with the same single-winner guarded update
 * the markdown path uses (guarded on `billing_status = 'processing'`, so a
 * concurrent legitimate settle always wins and is never clobbered).
 *
 * Scope boundary (ADR 021 Phases 3 vs 4): this records that the row is
 * partial-and-retryable, with the specific missing dimensions — it does NOT
 * trigger any LLM/worker regeneration or client retry. Phase 4's selective
 * client dispatch (useSSEStream.ts) is the consumer of this state.
 *
 * Returns:
 * - 'requeued' — requeue patch committed (row still `processing`)
 * - 'raced'    — guarded write lost (a concurrent settle/reap moved the row
 *                off `processing` first; nothing was clobbered)
 * - 'unknown'  — the update call itself errored (network/timeout) AFTER
 *                possibly already committing server-side; whether it
 *                actually landed is genuinely unknown from this response
 *                alone. Callers MUST treat this the same as 'requeued'/
 *                'raced' (skip this row this sweep, do NOT fall through to
 *                a terminal settle) — falling through here risks
 *                overwriting a requeue that actually committed with a
 *                'failed' settle, silently discarding real partial work.
 *                The next sweep re-reads the row's true state and decides
 *                again; nothing is lost by waiting one more cycle.
 * - null       — not a requeue candidate (falls through to the existing
 *                terminal paths)
 *
 * Race note (reviewed per race-condition-guard): a requeued row REMAINS
 * `processing`, so two overlapping sweeps can both pass the guard (which
 * only checks `billing_status = 'processing'`, not the retry count itself)
 * and both write. Both compute `nextRetryCount` from the SAME stale
 * `currentRetryCount` snapshot, so the net effect is a single applied
 * increment (last write wins on the JSON field), not a double-increment —
 * the retry ceiling is under-enforced by up to one requeue per concurrent
 * collision, not over-enforced. This is a real, currently-unfixed gap
 * (closing it needs an atomic compare-and-swap on the JSON counter, e.g. a
 * dedicated Postgres RPC — a bigger, migration-shaped change deliberately
 * NOT bundled into this pass) but its blast radius is small: reaper sweeps
 * run on a periodic cron (ADR 007), not at a frequency where concurrent
 * collisions on the SAME stuck row are a realistic hot path, and the worst
 * case is "retried slightly more than `remediation.maxRetries` intends,"
 * never data loss or an unbounded loop (the ceiling still eventually
 * binds). Tracked as follow-up, not silently ignored.
 */
// skipcq: JS-0067
export function extractPayloadDimensionNumbers(payload: unknown): Set<number> {
  if (!payload || typeof payload !== 'object') return new Set();
  const rawDimensions = (payload as { dimensions?: unknown }).dimensions;
  if (!Array.isArray(rawDimensions)) return new Set();
  const numbers = new Set<number>();
  for (const item of rawDimensions) {
    if (typeof item === 'object' && item !== null) {
      const num =
        (item as { number?: unknown; dimensionNumber?: unknown; dimension?: unknown }).number ??
        (item as { number?: unknown; dimensionNumber?: unknown; dimension?: unknown }).dimensionNumber ??
        (item as { number?: unknown; dimensionNumber?: unknown; dimension?: unknown }).dimension;
      if (typeof num === 'number' && Number.isInteger(num)) {
        numbers.add(num);
      }
    }
  }
  return numbers;
}

// skipcq: JS-0067
export function isAmbiguousTransportError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  // skipcq: TS-0004 -- explicit null-guard on unknown before property access; !error above narrows out null but TS-0004 still fires
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  return (
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('abort') ||
    code === '504' ||
    code === '502' ||
    code === '503'
  );
}

export const tryRequeuePartial = async (
  row: { id: string; validation_report: unknown },
  persistenceAdapter: SupabasePersistenceAdapter,
  maxRetries: number
): Promise<'requeued' | 'raced' | 'unknown' | 'error' | null> => {
  const chunks = await persistenceAdapter.findAnalysisChunks({ analysisId: row.id });
  const chunkRows = chunks ?? [];

  // Strengthened trust rule: only chunks that individually completed WITH
  // valid dimensions present in BOTH dimensions_covered AND the payload
  // contribute coverage.
  const coveredDimensions = chunkRows
    .filter(chunk => chunk.status === 'completed')
    .flatMap(chunk => {
      const payloadNumbers = extractPayloadDimensionNumbers(chunk.payload);
      const covered = Array.isArray(chunk.dimensions_covered) ? chunk.dimensions_covered : [];
      return covered.filter(
        num => Number.isInteger(num) && num >= 1 && num <= TOTAL_DIMENSIONS && payloadNumbers.has(num)
      );
    });

  const currentRetryCount = readRemediationRetryCount(row.validation_report);
  const decision = decideRequeuePartial(coveredDimensions, currentRetryCount, maxRetries);
  if (!decision) return null;

  const { patch } = buildRequeuePatch(decision.missingDimensions, row.validation_report, currentRetryCount + 1);
  const service = getSupabaseServiceClient();

  // Atomic CAS: guard on billing_status='processing' AND expected retry count,
  // preventing two concurrent sweeps from reading the same snapshot and overwriting.
  let updateQuery = service
    .from('analyses')
    .update(patch, { count: 'exact' })
    .eq('id', row.id)
    .eq('billing_status', 'processing');

  if (currentRetryCount === 0) {
    updateQuery = updateQuery.or(
      'validation_report->>remediation_retry_count.is.null,validation_report->>remediation_retry_count.eq.0'
    );
  } else {
    updateQuery = updateQuery.eq('validation_report->>remediation_retry_count', String(currentRetryCount));
  }

  const { error: updErr, count } = await updateQuery;
  if (updErr) {
    return isAmbiguousTransportError(updErr) ? 'unknown' : 'error';
  }
  return count ? 'requeued' : 'raced';
};
