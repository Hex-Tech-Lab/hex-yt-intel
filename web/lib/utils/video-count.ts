/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the string shape VideoMetadata.viewCount/likeCount use, without
 * losing the value: a string-typed count was previously coerced to 0 on
 * restore, so counts vanished whenever an analysis was restored or started
 * (UAT, 2026-10-08). Only plain non-negative integers count; anything else
 * (negatives, fractions, hex/exponent forms) is invalid.
 */
/** A non-negative safe integer. */
const isCountNumber = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A non-empty string of ASCII digits (surrounding whitespace ignored). */
const isCountString = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const digits = value.trim();
  return digits.length > 0 && [...digits].every((char) => char >= '0' && char <= '9');
};

/** Either form VideoMetadata counts can arrive in. */
const isValidCount = (value: unknown): boolean => isCountNumber(value) || isCountString(value);

/** Normalised count string for display, or '0' when the value is not a valid count. */
export const toCountValue = (value: unknown): string => (isValidCount(value) ? String(value).trim() : '0');

/** First candidate that is a valid count (a valid 0 counts); '0' if none is. */
export const pickCount = (...candidates: unknown[]): string => toCountValue(candidates.find(isValidCount));
