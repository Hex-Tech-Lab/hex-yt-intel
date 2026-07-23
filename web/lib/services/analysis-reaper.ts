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
import { stitchChunksIntoPayload, buildDimensionStatus } from '@/lib/services/stitch-analysis-chunks';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import type { BillingStatus } from '@/lib/types/validation-report';

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

export type ReapOutcome = 'completed' | 'failed';

/**
 * Pure decision — given a stuck row's markdown, decide salvage-vs-fail and
 * report the derived dimension count. Exported for unit testing.
 */
export function decideReapOutcome(analysisMarkdown: string | null | undefined): {
  outcome: ReapOutcome;
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
  raced: number; // rows a concurrent settle won before us
}

interface StuckRow {
  id: string;
  analysis_markdown: string | null;
  validation_report: Record<string, unknown> | null;
}

export interface SettlePatch {
  billing_status: BillingStatus;
  validation_passed: boolean;
  validation_report: Record<string, unknown>;
  updated_at: string;
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
 * Returns null when chunks aren't fully complete, or when the recovery
 * attempt itself fails for any reason -- the caller falls through to the
 * existing markdown-based decision in both cases, so this path can only
 * ever ADD a recovery option, never take one away.
 */
async function tryChunkRecovery(
  analysisId: string,
  existingReport: unknown,
  persistenceAdapter: SupabasePersistenceAdapter
): Promise<{ outcome: ReapOutcome } | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('analysis_chunks')
    .select('chunk_index, payload, status')
    .eq('analysis_id', analysisId);
  if (error) throw error;

  const chunkRows = (data ?? []) as ChunkRow[];
  if (!chunksAreFullyComplete(chunkRows)) return null;

  const chunkMap = new Map<number, any>(chunkRows.map(c => [c.chunk_index, c.payload]));
  const stitchResult = stitchChunksIntoPayload(chunkMap, TOTAL_STREAMS);
  if (!stitchResult.payload) return null;

  const { dimensionStatus, validationStatus, billingStatus } = buildDimensionStatus(stitchResult.payload);
  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  const nowIso = new Date().toISOString();
  const newReport = {
    ...baseReport,
    validation_status: validationStatus,
    status: validationStatus,
    billing_status: billingStatus,
    dimension_status: dimensionStatus,
    valid: stitchResult.validationPassed && validationStatus === 'done',
    reaped: true,
    reaped_via: 'chunk_recovery',
    reaped_at: nowIso,
  };

  // Guarded: only commits if this row is STILL `processing` -- same
  // single-winner race protection as the markdown-based path below, reused
  // (not re-implemented) via updateAnalysisResult's guardBillingStatus.
  const { updated } = await persistenceAdapter.updateAnalysisResult({
    analysisId,
    markdown: stitchResult.markdown,
    payload: stitchResult.payload,
    model: null,
    validationPassed: stitchResult.validationPassed,
    validationReport: newReport,
    guardBillingStatus: 'processing',
  });
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
  const result: SweepResult = { scanned: stuck.length, completed: 0, failed: 0, raced: 0 };

  for (const row of stuck) {
    // Chunk-based recovery is tried FIRST and is strictly additive: on any
    // exception, or when chunks aren't fully complete, or when this row lost
    // a concurrent race, we fall through to the exact same markdown-based
    // path this reaper always used -- never a behavior regression, only a
    // new way to correctly recover a case the old path would have discarded.
    try {
      const recovered = await tryChunkRecovery(row.id, row.validation_report, persistenceAdapter);
      if (recovered) {
        if (recovered.outcome === 'completed') result.completed++;
        else result.failed++;
        continue;
      }
    } catch (chunkErr) {
      Sentry.captureException(chunkErr, {
        tags: { service: 'analysis-reaper', phase: 'chunk_recovery' },
        extra: { analysisId: row.id },
      });
      // fall through intentionally
    }

    const { outcome, patch } = buildSettlePatch(row.analysis_markdown, row.validation_report);

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
