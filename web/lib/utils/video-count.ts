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
  /** The count as a digit string, or null when the value is not a valid count. */
  parseCount(value: unknown): string | null {
    const digits = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
    const parsed = Number(digits);
    return digits !== '' && Number.isSafeInteger(parsed) && parsed >= 0 && String(parsed) === digits ? digits : null;
  },

  /** Normalised count string for display; '0' when the value is not a valid count. */
  toCountValue(value: unknown): string {
    return videoCount.parseCount(value) ?? '0';
  },

  /** First candidate that is a valid count (a valid 0 counts); '0' if none is. */
  pickCount(...candidates: unknown[]): string {
    return candidates.map((candidate) => videoCount.parseCount(candidate)).find((count) => count !== null) ?? '0';
  },
};
