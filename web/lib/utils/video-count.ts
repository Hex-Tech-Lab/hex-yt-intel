/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the display type without losing the value: a string-typed count was
 * previously coerced to 0 on restore, so counts vanished whenever an analysis
 * was restored or started (UAT, 2026-10-08). Only plain non-negative integers
 * count; anything else (negatives, fractions, hex/exponent forms) is 0.
 */
export const toCountValue = (value: unknown): string | number => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  return 0;
};
