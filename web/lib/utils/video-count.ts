/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the string shape VideoMetadata.viewCount/likeCount use, without
 * losing the value: a string-typed count was previously coerced to 0 on
 * restore, so counts vanished whenever an analysis was restored or started
 * (UAT, 2026-10-08). Only plain non-negative integers count; anything else
 * (negatives, fractions, hex/exponent forms) is invalid.
 */
const isValidCount = (value: unknown): value is number | string =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
  (typeof value === 'string' && /^\d+$/.test(value.trim()));

export const toCountValue = (value: unknown): string => {
  if (!isValidCount(value)) return '0';
  return String(value).trim();
};

/** First candidate that is a valid count (a valid 0 counts); '0' if none is. */
export const pickCount = (...candidates: unknown[]): string => toCountValue(candidates.find(isValidCount));
