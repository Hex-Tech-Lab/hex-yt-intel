/**
 * ADR 021 Phase 2 — presence-check-on-resume.
 *
 * Phase 1 (PR #216) already persists each bundle chunk's dimensions as it
 * completes (`analysis_chunks.dimensions_covered` / `analysis_chunks.payload`,
 * upserted per (analysis_id, chunk_index)). What was missing is the read side:
 * on a resume/retry of a dead or partial analysis, nothing consults that
 * journal before re-requesting work, so every completed chunk's LLM spend was
 * blindly paid again (live incident, analysis 32aeeb78, 2026-09-08: 2/5
 * chunks durable, all 5 would be re-requested).
 *
 * This module exposes that read side as a pure, unit-testable decision
 * (`computeMissingChunkDimensions`) plus a thin port-calling wrapper
 * (`getMissingDimensionNumbers`) other code can call — mirroring the reaper's
 * extracted-pure-function pattern (analysis-reaper.ts's decideReapOutcome).
 * The actual "only fetch these bundles" dispatch change is ADR 021 Phase 4,
 * deliberately NOT here.
 *
 * TRUST RULE (single rule, uniformly applied — same rule three independent
 * consumers already enforce): a dimension counts as covered only when it
 * appears in `dimensions_covered` of a chunk row whose `status === 'completed'`.
 * - The persist route derives `dimensions_covered` from the chunk payload
 *   regardless of status, and an interrupted chunk's payload can come from
 *   `BracketBuffer.finalize()`'s best-effort repair (ADR 021 Phase 1
 *   Implementation Note) — a non-completed row's dimensions are NOT
 *   trustworthy and must be re-requested.
 * - The reaper's partial-recovery filter (analysis-reaper.ts tryChunkRecovery)
 *   and the persist route's FINAL_CHUNK_STATUS check both already apply this
 *   exact "only 'completed' counts" rule; this module is the same rule
 *   extracted once instead of a fourth divergent copy.
 *
 * No new schema, no new Settings Registry key, no migration (per the ADR's
 * own Phase 1 note — existing infrastructure covers this once wired).
 */
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/**
 * Minimal structural view of one `analysis_chunks` row, matching the fields
 * `AnalysisPersistencePort.findAnalysisChunks` returns for this decision.
 */
export interface ChunkPresenceRow {
  chunk_index: number;
  dimensions_covered: number[] | null;
  status: 'completed' | 'failed' | 'interrupted';
}

/** True when `candidate` is a real, in-range dimension number worth trusting as covered. */
const isValidDimensionNumber = (candidate: unknown, totalDimensions: number): candidate is number =>
  typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 1 && candidate <= totalDimensions;

/**
 * Pure decision core. Given the chunk rows persisted for one analysis, return
 * the ascending dimension numbers in [1..totalDimensions] NOT covered by any
 * `status === 'completed'` chunk row.
 *
 * - `null`/undefined/empty rows → all dimensions missing (caller's existing
 *   fresh-analysis path is just the all-missing case; no special branch).
 * - Malformed coverage entries (non-integers, out-of-range numbers, duplicates)
 *   are ignored; a null `dimensions_covered` array covers nothing.
 * - Failed/interrupted rows NEVER contribute coverage — see TRUST RULE above.
 */
export const computeMissingChunkDimensions = (
  chunkRows: ChunkPresenceRow[] | null | undefined,
  totalDimensions: number
): number[] => {
  const completedRows = (chunkRows ?? []).filter((row) => row.status === 'completed');
  const coveredNumbers = completedRows.flatMap((row) => row.dimensions_covered ?? []);
  const covered = new Set(coveredNumbers.filter((candidate) => isValidDimensionNumber(candidate, totalDimensions)));

  const allDimensions = Array.from({ length: totalDimensions }, (_unused, i) => i + 1);
  return allDimensions.filter((dimension) => !covered.has(dimension));
};

/**
 * Presence check for one analysis: which dimension numbers are NOT yet
 * covered by any successfully-completed chunk in `analysis_chunks`.
 *
 * Errors from the persistence adapter propagate to the caller (the adapter
 * already Sentry-captures its own failures); the caller owns retry/reporting
 * policy. `totalDimensions` defaults to the canonical TOTAL_DIMENSIONS so a
 * caller on the standard 11-dimension pipeline can omit it.
 */
export const getMissingDimensionNumbers = async (
  analysisId: string,
  totalDimensions: number = TOTAL_DIMENSIONS
): Promise<number[]> => {
  const chunks = await new SupabasePersistenceAdapter().findAnalysisChunks({ analysisId });
  return computeMissingChunkDimensions(chunks, totalDimensions);
};
