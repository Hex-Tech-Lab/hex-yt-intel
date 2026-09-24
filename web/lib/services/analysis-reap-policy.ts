/**
 * Reaper settle-policy (extracted from analysis-reaper.ts, 2026-09-24 —
 * the file exceeded the 500-line qa-intel monolith gate; the pure
 * markdown/chunk settlement decisions split cleanly from the reaper's
 * I/O sweep logic, same sibling-module split analysis-requeue.ts and
 * dimension-remediation.ts already document).
 */
import { countUcisDimensions } from '@/lib/utils/count-ucis-dimensions';
import { TOTAL_DIMENSIONS, TOTAL_STREAMS, MIN_USABLE_DIMENSIONS } from '@/lib/config/synthesis';
import type { ReapOutcome, SettlePatch } from '@/lib/services/analysis-requeue';

/**
 * Minimum dimensions for a partial analysis to be salvaged as `completed`.
 * Re-exports the single-source `MIN_USABLE_DIMENSIONS` so the reaper and the
 * cache read path (SupabaseAnalysisAdapter) can never disagree on what counts
 * as a usable analysis.
 */
export const MIN_SALVAGEABLE_DIMENSIONS = MIN_USABLE_DIMENSIONS;

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
// skipcq: JS-0057 -- TS ES module (has imports/exports), not a browser script; module scope, not global
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
 * BillingStatus type for the full RCA -- this is the same bug
 * analysis-reaper.ts's tryChunkRecovery (chunk-recovery path) was built to
 * route around, just on the reaper's older markdown-only path. NOTE: only
 * `patch.billing_status` requires the full TOTAL_DIMENSIONS set (strict
 * 100%-or-failed); the outcome itself completes at MIN_SALVAGEABLE_DIMENSIONS.
 */
// skipcq: JS-R1005 -- complexity inherent to the settle-patch contract (full/partial/failed), pre-existing shape
// skipcq: JS-0057 -- TS ES module (has imports/exports), not a browser script; module scope, not global
export function buildSettlePatch(
  analysisMarkdown: string | null | undefined,
  existingReport: unknown,
  nowIso: string = new Date().toISOString(),
): { outcome: ReapOutcome; patch: SettlePatch } {
  const { outcome, dimensionCount } = decideReapOutcome(analysisMarkdown);
  const isComplete = outcome === 'completed' && dimensionCount >= TOTAL_DIMENSIONS;
  const reportStatus = outcome === 'failed' ? 'failed' : isComplete ? 'complete' : 'partial';

  // ONLY chargeable at 100% (matches buildDimensionStatus/decideChunkSalvagePolicy).
  // `outcome` alone used to gate this at MIN_SALVAGEABLE_DIMENSIONS (8/11).
  const billingStatus = isComplete ? 'completed' : 'failed';

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
// skipcq: JS-R1005 -- complexity inherent to the full-chunk-set validation contract, pre-existing shape
// skipcq: JS-0057 -- TS ES module (has imports/exports), not a browser script; module scope, not global
export function chunksAreFullyComplete(chunkRows: ChunkRow[]): boolean {
  if (chunkRows.length !== TOTAL_STREAMS) return false;
  const byIndex = new Map(chunkRows.map((chunkRow) => [chunkRow.chunk_index, chunkRow]));
  for (let i = 1; i <= TOTAL_STREAMS; i++) {
    const chunkRow = byIndex.get(i);
    if (!chunkRow || chunkRow.status !== 'completed') return false;
    if (
      !chunkRow.payload ||
      !Array.isArray((chunkRow.payload as { dimensions?: unknown }).dimensions)
    )
      return false;
  }
  return true;
}
