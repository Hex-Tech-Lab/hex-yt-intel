/**
 * Shared Settings Registry keys/bounds for the highlights-reel feature --
 * was declared separately in the authenticated route and the public share
 * page (CodeRabbit review, PR #233); one source of truth now.
 */
export const HIGHLIGHTS_REGISTRY_FALLBACK = {
  'highlights.segmentDurationSeconds': 10,
  'highlights.contextLeadSeconds': 2.5,
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
