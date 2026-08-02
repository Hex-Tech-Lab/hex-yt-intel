import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import type { HistoryOverviewItem } from '@/lib/ports';
import type { ClientPlatform } from '@/lib/utils/client-platform';

/**
 * Raw row shape returned by the `get_user_history_overview` Postgres function
 * (snake_case, one row per base video). Kept local to the mapping boundary so
 * the rest of the app only sees the camelCase {@link HistoryOverviewItem}.
 */
export interface RawHistoryOverviewRow {
  base_video_id: string;
  latest_analysis_id: string;
  title: string | null;
  channel_title: string | null;
  first_analyzed_at: string;
  last_analyzed_at: string;
  last_viewed_at: string | null;
  times_analyzed: number | string;
  views: number | string;
  best_dimensions: number | null;
  present_dimensions: number[] | null;
  status: HistoryOverviewItem['status'];
  has_digest: boolean | null;
  has_description: boolean | null;
  has_channel_meta: boolean | null;
  has_comments: boolean | null;
  client_platform: ClientPlatform | null;
}

/**
 * The UCIS dimensions (1..{@link TOTAL_DIMENSIONS}) absent from an analysis,
 * given the set that IS present. Drives the "re-analyze the missing N" affordance.
 */
export function computeMissingDimensions(present: readonly number[]): number[] {
  const have = new Set(present);
  const missing: number[] = [];
  for (let n = 1; n <= TOTAL_DIMENSIONS; n++) {
    if (!have.has(n)) missing.push(n);
  }
  return missing;
}

/**
 * Map one aggregation row to the camelCase domain item. Pure (no I/O) so the
 * grouping/enrichment contract is unit-testable without a live database —
 * mirrors the reaper's extracted-pure-function pattern.
 *
 * `count(*)`/`sum(...)` come back from PostgREST as bigint strings; coerce them
 * to numbers here so consumers never have to.
 */
export function mapHistoryOverviewRow(row: RawHistoryOverviewRow): HistoryOverviewItem {
  const presentDimensions = (row.present_dimensions ?? []).slice().sort((a, b) => a - b);
  return {
    baseVideoId: row.base_video_id,
    analysisId: row.latest_analysis_id,
    title: row.title || 'Untitled Analysis',
    channelTitle: row.channel_title ?? null,
    firstAnalyzedAt: row.first_analyzed_at,
    lastAnalyzedAt: row.last_analyzed_at,
    lastViewedAt: row.last_viewed_at,
    timesAnalyzed: Number(row.times_analyzed) || 0,
    views: Number(row.views) || 0,
    bestDimensions: row.best_dimensions ?? 0,
    presentDimensions,
    missingDimensions: computeMissingDimensions(presentDimensions),
    status: row.status,
    hasDigest: !!row.has_digest,
    hasDescription: !!row.has_description,
    hasChannelMeta: !!row.has_channel_meta,
    hasComments: !!row.has_comments,
    clientPlatform: row.client_platform ?? null,
  };
}
