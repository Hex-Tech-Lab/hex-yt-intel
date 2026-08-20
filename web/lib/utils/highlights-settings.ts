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
