/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the string shape VideoMetadata.viewCount/likeCount use, without
 * losing the value: a string-typed count was previously coerced to 0 on
 * restore, so counts vanished whenever an analysis was restored or started
 * (UAT, 2026-10-08). Only plain non-negative integers count; anything else
 * (negatives, fractions, hex/exponent forms) is invalid.
 */
const isCountNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isCountString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value.trim());

const isValidCount = (value: unknown): value is number | string => isCountNumber(value) || isCountString(value);

/** Normalised count string for display, or '0' when the value is not a valid count. */
export const toCountValue = (value: unknown): string => (isValidCount(value) ? String(value).trim() : '0');

/** First candidate that is a valid count (a valid 0 counts); '0' if none is. */
export const pickCount = (...candidates: unknown[]): string => toCountValue(candidates.find(isValidCount));
