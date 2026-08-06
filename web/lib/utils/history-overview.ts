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
  has_chapters: boolean | null;
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
  const rawTitle = row.title?.trim() || '';
  // Non-descriptive title detection: bare dates in "Month D, YYYY", "YYYY-MM-DD",
  // or short "M/D/YY" / "D/M/YY" forms, plus empty/whitespace. A real date-only
  // title is useless in a history list, so prepend the channel name when known.
  const isNonDescriptiveTitle =
    !rawTitle ||
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(rawTitle) ||
    /^\d{4}-\d{2}-\d{2}$/.test(rawTitle) ||
    /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(rawTitle);

  const channel = row.channel_title?.trim();
  let cleanTitle = rawTitle;
  if (isNonDescriptiveTitle) {
    // Known channel: prepend it to the bare date/empty title (still useful --
    // "Mark Johnson — April 28, 2026" beats nothing). No channel: rawTitle
    // must NOT be used here even as a last resort -- it's the exact date/
    // empty string this branch exists to replace. The old
    // `rawTitle || fallback` bug re-selected it whenever rawTitle was a
    // non-empty date (dates are truthy) -- reported 2026-08-06, a
    // presentation-skills lecture with no channel_title still showed its
    // date-only title in history.
    cleanTitle = channel
      ? `${channel} — ${rawTitle || 'Untitled Analysis'}`
      : row.base_video_id
        ? `Video (${row.base_video_id})`
        : 'Untitled Analysis';
  }

  return {
    baseVideoId: row.base_video_id,
    analysisId: row.latest_analysis_id,
    title: cleanTitle,
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
    hasChapters: row.has_chapters ?? null,
    clientPlatform: row.client_platform ?? null,
  };
}
