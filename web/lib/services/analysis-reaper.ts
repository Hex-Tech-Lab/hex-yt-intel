/**
 * Analysis Reaper (ADR 007 — Persistence lifecycle recovery)
 *
 * A YouTube analysis streams browser ↔ Cloudflare Worker; the Worker persists
 * the final row with appropriate billing_status ('chargeable' or 'charged') via
 * `waitUntil` when the stream settles. If the Worker times out, the client disconnects,
 * or the process is reclaimed before that settle runs, the row is orphaned in
 * `billing_status = 'processing'` forever — it then shows up in history as a
 * permanent "processing" ghost with no output.
 *
 * The reaper is the safety net: on a schedule (QStash cron → /api/webhooks/reaper)
 * it sweeps rows stuck in `processing` past a grace window and settles each to a
 * terminal state — salvaging any that already have enough generated content,
 * failing the rest. It is idempotent (single-winner UPDATE guarded on
 * `billing_status = 'processing'`) so a legitimately-late settle always wins.
 */
import { getSupabaseServiceClient } from '@/lib/supabase';
import { countUcisDimensions } from '@/lib/utils/count-ucis-dimensions';
import { TOTAL_DIMENSIONS, MIN_USABLE_DIMENSIONS } from '@/lib/config/synthesis';
import * as Sentry from '@sentry/nextjs';

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

// Outcome of reaper decision; maps to billing_status enum
export type ReapOutcome = 'chargeable' | 'failed';

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
    outcome: dimensionCount >= MIN_SALVAGEABLE_DIMENSIONS ? 'chargeable' : 'failed',
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
  billing_status: ReapOutcome;
  validation_passed: boolean;
  validation_report: Record<string, unknown>;
  updated_at: string;
}

/**
 * Build the terminal-state row patch for a stuck analysis (pure — no I/O).
 * Salvages a full analysis as chargeable, a usable partial as chargeable (but partial validation),
 * and anything below the threshold as failed; preserves the prior report fields.
 * Exported for unit testing.
 */
export function buildSettlePatch(
  analysisMarkdown: string | null | undefined,
  existingReport: unknown,
  nowIso: string = new Date().toISOString(),
): { outcome: ReapOutcome; patch: SettlePatch } {
  const { outcome, dimensionCount } = decideReapOutcome(analysisMarkdown);
  const isComplete = outcome === 'chargeable' && dimensionCount >= TOTAL_DIMENSIONS;
  const reportStatus = outcome === 'failed' ? 'failed' : isComplete ? 'done' : 'partial';
  // jsonb can decode to an array/scalar too; only spread a plain object so the
  // report shape stays consistent.
  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  return {
    outcome,
    patch: {
      billing_status: outcome,
      validation_passed: isComplete,
      validation_report: { ...baseReport, status: reportStatus, reaped: true, reaped_at: nowIso, reaped_dimensions: dimensionCount },
      updated_at: nowIso,
    },
  };
}

/**
 * Sweep and settle stuck `processing` analyses. Safe to run repeatedly.
 */
export async function sweepStuckAnalyses(opts?: { graceMinutes?: number; limit?: number }): Promise<SweepResult> {
  const graceMinutes = opts?.graceMinutes ?? REAP_GRACE_MINUTES;
  const limit = opts?.limit ?? 500;
  const service = getSupabaseServiceClient();
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
    if (outcome === 'chargeable') result.completed++;
    else result.failed++;
  }

  return result;
}
