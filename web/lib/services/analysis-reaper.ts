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
import { getSupabaseServiceClient } from '@/lib/supabase';
import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import * as Sentry from '@sentry/nextjs';

/**
 * Minimum dimensions for a partial analysis to be salvaged as `completed`.
 * Mirrors the cache-hit "usable" threshold in SupabaseAnalysisAdapter
 * (`dimensionCount < 8` is treated as a miss), so the reaper and the read path
 * agree on what counts as a usable analysis.
 */
export const MIN_SALVAGEABLE_DIMENSIONS = 8;

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
  const dims = analysisMarkdown ? parseUcisDimensions(analysisMarkdown) : {};
  const dimensionCount = Object.keys(dims).length;
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
    const { outcome, dimensionCount } = decideReapOutcome(row.analysis_markdown);
    const isComplete = outcome === 'completed' && dimensionCount >= TOTAL_DIMENSIONS;
    const reportStatus = outcome === 'failed' ? 'failed' : isComplete ? 'complete' : 'partial';
    const nowIso = new Date().toISOString();
    const baseReport = row.validation_report && typeof row.validation_report === 'object' ? row.validation_report : {};

    // Single-winner UPDATE: only mutate rows STILL `processing`, so a concurrent
    // legitimate settle (which also writes billing_status) wins the race and we
    // never clobber a real completion.
    const { error: updErr, count } = await service
      .from('analyses')
      .update(
        {
          billing_status: outcome,
          validation_passed: isComplete,
          validation_report: { ...baseReport, status: reportStatus, reaped: true, reaped_at: nowIso, reaped_dimensions: dimensionCount },
          updated_at: nowIso,
        },
        { count: 'exact' },
      )
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
