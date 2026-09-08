/**
 * Shared Settings Registry keys/bounds for the highlights-reel feature --
 * was declared separately in the authenticated route and the public share
 * page (CodeRabbit review, PR #233); one source of truth now.
 */
/** Playback-position poll cadence -- single source of truth for anything
 *  that visualizes `currentPlaybackSeconds` (HighlightsTrack.tsx's playhead
 *  needle). Lives here, not in VideoPlayerCard.tsx, deliberately: this file
 *  is shared by the authenticated HighlightsScrubber AND the public,
 *  store-free PublicHighlightsReel.tsx -- importing from VideoPlayerCard.tsx
 *  would pull its whole module (including useVideoStore) into the public
 *  share page's bundle (Cubic review, PR #300). */
export const PLAYBACK_POLL_INTERVAL_MS = 250;

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
  // Natural durations (2026-08-29, fix flattening): allow 15-60s natural
  // topic boundaries anchored to transcript timestamps, distinct per takeaway.
  'highlights.minSegmentDurationSeconds': 15,
  'highlights.maxSegmentDurationSeconds': 60,
} as const;

/**
 * Bounded-retry parameters for the client-side "highlights might not be
 * persisted yet" race: `analysis_highlights` rows for a fresh analysis are
 * written asynchronously by `scheduleHighlightsRecovery()` (ADR/PR #290),
 * triggered by digest generation, via Next.js `after()` -- the digest
 * response itself returns before that background work finishes, so even
 * "digest is done" doesn't mean "highlights row already exists," just
 * "the highlights-recovery call has now been scheduled."
 *
 * Deliberately NOT a video-length-scaled timeout. The part of this whole
 * pipeline that scales with video length -- the digest generation itself,
 * summarizing however many takeaways a longer/denser video produces -- is
 * a SEPARATE wait the client already tracks natively via
 * `useExecutiveDigest`'s own `digestLoading` state (a real Vercel/AI-call
 * duration, not a client-side guess). The highlights-fetch retry loop
 * below is NOT meant to cover that wait -- callers MUST restart/re-trigger
 * this retry sequence specifically when `digestLoading` transitions from
 * true to false (see `HighlightsScrubber.tsx` and `useHighlightsStatus.ts`
 * for the two call sites), not run it blindly from component mount. Once
 * digest itself is done, the ONLY remaining latency is the highlights
 * extraction's own bounded LLM call over the already-extracted takeaways
 * (NOT the raw transcript) -- a cost that does not grow with video length,
 * which is what these retry constants are actually sized for.
 *
 * Real observed timing (2026-09-08, live production repro, video
 * MTZwSjiDg30 under a fresh test-account analysis, verified directly
 * against the DB): 5/5 SSE streams completed at 22:01:44 UTC+3; digest
 * generation + highlights backfill together landed the 10 real rows at
 * 22:01:58 UTC+3 -- a ~14s gap from stream-completion. The PREVIOUS retry
 * budget (3 attempts, 2.5s/5s backoff, ~7.5s window, run from mount rather
 * than from digest completion) was both wrongly-triggered (counted from
 * stream-end, not digest-end) and too short, permanently showing "No
 * highlights yet" until an unrelated manual refresh forced a fresh fetch
 * after the backfill had since completed. These values give real headroom
 * (~4x the one observed data point) over the digest-independent tail
 * latency specifically. Delay per attempt is
 * `min(BASE_DELAY_MS * 2^attempt, MAX_DELAY_MS)` -- capped exponential,
 * not unbounded exponential, so a larger MAX_ATTEMPTS can't make a single
 * retry wait minutes.
 */
export const HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS = 5;
export const HIGHLIGHTS_STATUS_RETRY_BASE_DELAY_MS = 2500;
export const HIGHLIGHTS_STATUS_RETRY_MAX_DELAY_MS = 15000;

/** Capped exponential backoff shared by both highlights-status retry loops. */
export function getHighlightsRetryDelayMs(attempt: number): number {
  return Math.min(HIGHLIGHTS_STATUS_RETRY_BASE_DELAY_MS * Math.pow(2, attempt), HIGHLIGHTS_STATUS_RETRY_MAX_DELAY_MS);
}

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

export function calculateEffectiveHighlightBudget(
  videoDurationSeconds: number,
  takeawaysCount: number,
  targetPerTakeawaySeconds = 15
): number {
  const base = calculateAttentionBoundedBudget(videoDurationSeconds);
  if (!Number.isFinite(takeawaysCount) || takeawaysCount <= 0) return base;
  const minRequired = takeawaysCount * 15;
  const ideal = takeawaysCount * targetPerTakeawaySeconds;
  const raw = Math.max(base, minRequired, ideal);
  if (Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0) {
    return Math.min(raw, videoDurationSeconds);
  }
  return raw;
}

export const calculateHighlightBudgetSeconds = calculateAttentionBoundedBudget;
