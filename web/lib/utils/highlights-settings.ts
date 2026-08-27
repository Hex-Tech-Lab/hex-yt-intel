/**
 * Shared Settings Registry keys/bounds for the highlights-reel feature --
 * was declared separately in the authenticated route and the public share
 * page (CodeRabbit review, PR #233); one source of truth now.
 */
export const HIGHLIGHTS_REGISTRY_FALLBACK = {
  'highlights.segmentDurationSeconds': 10,
  'highlights.contextLeadSeconds': 2.5,
  // Uncapped-selection tunables (2026-08-20, live user report -- see
  // 20260820120000_highlights_reel_uncap_settings.sql for the full RCA).
  // maxCount replaces the prior hardcoded MAX_HIGHLIGHTS=12 in
  // highlights-extraction.ts; maxOutputTokens replaces the implicit
  // DEFAULT_MAX_TOKENS=2000 completion fallback that was silently
  // truncating dense-video highlight sets before the count cap even
  // mattered.
  'highlights.maxCount': 40,
  'highlights.maxOutputTokens': 6000,
  // Variable segment-duration clamps (2026-08-21). The LLM now returns a
  // content-driven end timestamp (the real end of the topic, not the next
  // highlight's start). Playback/visual layers clamp each highlight's real
  // (end - start) to [min, max] so old data with the prior "end = next
  // segment start" semantics doesn't produce 15-minute "segments" while
  // new data isn't truncated shorter than the floor. Paired with the
  // 20260821120000_highlights_segment_duration_clamps.sql migration.
  'highlights.minSegmentDurationSeconds': 5,
  'highlights.maxSegmentDurationSeconds': 60,
} as const;

/** A malformed/missing/out-of-range registry value must never reach the
 *  client as-is -- it drives setTimeout durations and seek offsets in both
 *  the authenticated and public scrubber components. Same min/max bounds as
 *  the migration's own validation jsonb
 *  (20260813222120_highlights_reel_settings_registry.sql). */
export function clampHighlightsSetting(value: unknown, fallback: number, min: number, max: number): number {
  // Number(null) is 0, which would silently pass a min=0 bound as if it
  // were a real, intentional value instead of a missing one.
  if (value === null || value === undefined) return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) return fallback;
  return numericValue;
}

/** Single source of truth for the highlights-reel playback-speed range
 *  (tangent fix, 2026-08-20 shared-hook extraction -- previously the same
 *  0.5-3 bounds were hardcoded a THIRD time in
 *  YouTubePlayerAdapter.setPlaybackRate's clamp, independent of
 *  useSegmentPlayback's SPEED_OPTIONS UI list). Both derive from this. */
export const HIGHLIGHTS_SPEED_MIN = 0.5;
export const HIGHLIGHTS_SPEED_MAX = 3;

/** Shared by HighlightsScrubber.tsx and PublicHighlightsReel.tsx -- was
 *  duplicated verbatim in both (/simplify review, 2026-08-20). */
export function fmtHighlightsDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m${remainderSeconds.toString().padStart(2, '0')}s` : `${remainderSeconds}s`;
}

/** Returns the playback duration for a highlight, in seconds, clamped to [minDur, maxDur].
 *  If the highlight has a valid end > start, returns (end - start) clamped to [minDur, maxDur].
 *  Otherwise returns the provided segmentDurationSeconds (fallback for missing/invalid end), also clamped.
 *  The clamp is critical for OLD DB rows where end_seconds holds the old "next highlight start"
 *  semantics — without it, a 120-second gap between highlights would produce a 2-minute segment.
 */
export function getHighlightPlaybackDuration(
  highlight: { start: number; end: number },
  segmentDurationSeconds: number,
  minDur: number,
  maxDur: number,
): number {
  const rawDuration =
    Number.isFinite(highlight.end) && highlight.end > highlight.start
      ? highlight.end - highlight.start
      : segmentDurationSeconds;
  return Math.max(minDur, Math.min(maxDur, rawDuration));
}

/** Returns a clamped segment end time for a highlight, for use in the segments array
 *  passed to useSegmentPlayback. Clamps (end - start) to [minDur, maxDur] so old DB rows
 *  with unclamped end_seconds don't produce multi-minute playback segments.
 *  If end is missing/invalid, returns start + segmentDurationSeconds (the fixed fallback).
 */
export function getClampedSegmentEnd(
  highlight: { start: number; end: number },
  segmentDurationSeconds: number,
  minDur: number,
  maxDur: number,
  nextStart?: number,
): number {
  const rawEnd = (Number.isFinite(highlight.end) && highlight.end > highlight.start)
    ? highlight.end
    : highlight.start + segmentDurationSeconds;
  const rawDuration = rawEnd - highlight.start;
  let clampedDuration = Math.max(minDur, Math.min(maxDur, rawDuration));
  // Prevent minimum duration clamp from causing overlap with the next highlight
  if (nextStart !== undefined && highlight.start + clampedDuration > nextStart) {
    clampedDuration = Math.max(0, nextStart - highlight.start);
  }
  return highlight.start + clampedDuration;
}

/** Returns the raw duration for a highlight used in sum calculations.
 *  If the highlight has a valid end > start, returns (end - start).
 *  Otherwise returns the provided segmentDurationSeconds (fallback for missing/invalid end).
 *  Note: This does NOT apply a minimum of 1 second; callers should clamp to [min, max] as needed.
 */
export function getHighlightDurationForSum(
  highlight: { start: number; end: number },
  segmentDurationSeconds: number,
): number {
  return Number.isFinite(highlight.end) && highlight.end > highlight.start
    ? highlight.end - highlight.start
    : segmentDurationSeconds;
}

/** Sums the durations of highlights, where each highlight's duration is clamped to [minDur, maxDur].
 *  For each highlight, uses getHighlightDurationForSum to obtain the raw duration (with fallback),
 *  then clamps that duration to [minDur, maxDur] before summing.
 *  Returns the total sum.
 */
export function sumHighlightDurations(
  highlights: Array<{ start: number; end: number }>,
  segmentDurationSeconds: number,
  minDur: number,
  maxDur: number,
): number {
  return highlights.reduce((sum, highlight) => {
    const rawDur = getHighlightDurationForSum(highlight, segmentDurationSeconds);
    const clampedDur = Math.min(maxDur, Math.max(minDur, rawDur));
    return sum + clampedDur;
  }, 0);
}

export function calculateAttentionBoundedBudget(videoDurationSeconds: number): number {
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
    return 180;
  }
  if (videoDurationSeconds <= 300) {
    return Math.min(Math.round(videoDurationSeconds * 0.5), 120);
  }
  if (videoDurationSeconds <= 1800) {
    return 180;
  }
  if (videoDurationSeconds <= 3600) {
    return 240;
  }
  return Math.min(330, Math.round(180 + Math.log2(videoDurationSeconds / 1800) * 60));
}

export const calculateHighlightBudgetSeconds = calculateAttentionBoundedBudget;
