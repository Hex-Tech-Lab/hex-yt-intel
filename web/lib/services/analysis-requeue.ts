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
export function decideRequeuePartial(
  coveredDimensions: number[],
  currentRetryCount: number,
  maxRetries: number,
): { outcome: Extract<ReapOutcome, 'requeue-partial'>; missingDimensions: number[] } | null {
  const covered = new Set(coveredDimensions.filter(dim => Number.isInteger(dim) && dim >= 1 && dim <= TOTAL_DIMENSIONS));
  if (covered.size === 0) return null;
  if (covered.size >= MIN_SALVAGEABLE_DIMENSIONS) return null;
  if (currentRetryCount >= maxRetries) return null;
  const missingDimensions: number[] = [];
  for (let d = 1; d <= TOTAL_DIMENSIONS; d++) {
    if (!covered.has(d)) missingDimensions.push(d);
  }
  return { outcome: 'requeue-partial', missingDimensions };
}

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
export function buildRequeuePatch(
  missingDimensions: number[],
  existingReport: unknown,
  nextRetryCount: number,
  nowIso: string = new Date().toISOString(),
): { outcome: Extract<ReapOutcome, 'requeue-partial'>; patch: SettlePatch } {
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
}

/**
 * The shared retry counter (ADR 021 open-question 4: reuse
 * `remediation_retry_count`, no new field) — read the same way
 * dimension-remediation.ts reads it, so the reaper's requeues and the
 * remediation harness's attempts draw down ONE shared ceiling.
 */
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
 * - null       — not a requeue candidate (falls through to the existing
 *                terminal paths)
 *
 * Race note (double-increment, reviewed per race-condition-guard): a requeued
 * row REMAINS `processing`, so two overlapping sweeps can both win the
 * guarded write and both increment `remediation_retry_count`. This is the
 * same accepted exposure the remediation harness already carries (its
 * still-partial write is guarded on `'failed'`, which a still-partial row
 * re-enters), and it is bounded: the shared ceiling caps total requeues, so
 * a double-increment only spends retry budget faster — it can never unbound
 * the loop. The missing-dimensions payload itself is identical across both
 * writers, so no data divergence is possible.
 */
export async function tryRequeuePartial(
  row: { id: string; validation_report: unknown },
  persistenceAdapter: SupabasePersistenceAdapter,
  maxRetries: number
): Promise<'requeued' | 'raced' | null> {
  const chunks = await persistenceAdapter.findAnalysisChunks({ analysisId: row.id });
  const chunkRows = chunks ?? [];

  // Same trust rule as tryChunkRecovery's usableRows: only chunks that
  // individually completed WITH a dimensions payload carry checkpointed
  // dimensions worth counting — a chunk that never reached `completed`
  // (or lacks a dimensions array) must not vouch for its covered set.
  const coveredDimensions = chunkRows
    .filter(c => c.status === 'completed' && Array.isArray((c.payload as { dimensions?: unknown } | null)?.dimensions))
    .flatMap(c => (Array.isArray(c.dimensions_covered) ? c.dimensions_covered : []));

  const currentRetryCount = readRemediationRetryCount(row.validation_report);
  const decision = decideRequeuePartial(coveredDimensions, currentRetryCount, maxRetries);
  if (!decision) return null;

  const { patch } = buildRequeuePatch(decision.missingDimensions, row.validation_report, currentRetryCount + 1);
  const service = getSupabaseServiceClient();
  const { error: updErr, count } = await service
    .from('analyses')
    .update(patch, { count: 'exact' })
    .eq('id', row.id)
    .eq('billing_status', 'processing');
  if (updErr) throw updErr; // caller's catch falls through to the terminal failed settle
  return count ? 'requeued' : 'raced';
}
