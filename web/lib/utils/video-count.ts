/**
 * YouTube counts arrive as strings ("20334") from /api/metadata and from the
 * stored analysis payload, and as numbers from some older rows. Normalise
 * both to the display type without losing the value: a string-typed count was
 * previously coerced to 0 on restore, so counts vanished whenever an analysis
 * was restored or started (UAT, 2026-10-08).
 */
export function toCountValue(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value.trim();
  return 0;
}
