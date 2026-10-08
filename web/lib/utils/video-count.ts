/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the string shape VideoMetadata.viewCount/likeCount use, without
 * losing the value: a string-typed count was previously coerced to 0 on
 * restore, so counts vanished whenever an analysis was restored or started
 * (UAT, 2026-10-08). Only plain non-negative integers count; anything else
 * (negatives, fractions, hex/exponent forms) is invalid.
 */
export const videoCount = {
  /** Normalised count string for display; '0' when the value is not a valid count. */
  toCountValue(value: unknown): string {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : '0';
    if (typeof value !== 'string') return '0';
    const digits = value.trim();
    return digits.length > 0 && [...digits].every((char) => char >= '0' && char <= '9') ? digits : '0';
  },

  /** First candidate that is a valid count (a valid 0 counts); '0' if none is. */
  pickCount(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      const value = videoCount.toCountValue(candidate);
      const isZero = candidate === 0 || (typeof candidate === 'string' && candidate.trim() === '0');
      if (value !== '0' || isZero) return value;
    }
    return '0';
  },
};
