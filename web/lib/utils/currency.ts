/**
 * Format a USD-denominated value for display.
 * Uses 4 decimal places for values under $0.01 (but >= $0.0001),
 * 2 decimal places otherwise. Handles zero and micro-amounts explicitly
 * to avoid hiding real recorded charges. Negative amounts (refunds/
 * adjustments) keep their sign and magnitude instead of being
 * misclassified as near-zero by the micro-amount check. Non-finite input
 * (NaN/Infinity -- an upstream data bug, not a valid amount) renders as
 * an explicit placeholder rather than the literal string "$NaN".
 */
export function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (usd === 0) return '$0.00';
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  if (abs < 0.0001) return `${sign}<$0.0001`;
  return abs < 0.01 ? `${sign}$${abs.toFixed(4)}` : `${sign}$${abs.toFixed(2)}`;
}

/**
 * Format a USD-denominated value with 4 decimal places always.
 * Used where the previous inline implementation used toFixed(4)
 * and the caller expects sub-cent precision (e.g. UsageTab).
 */
export function fmtUsdPrecise(usd: number): string {
  if (!Number.isFinite(usd)) return '—';
  if (usd === 0) return '$0.0000';
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  if (abs < 0.0001) return `${sign}<$0.0001`;
  return `${sign}$${abs.toFixed(4)}`;
}

/**
 * Format a cents-denominated value (e.g. from Stripe) as USD string.
 * Divides by 100 first, then formats with fmtUsd semantics.
 */
export function fmtCentsToUsd(cents: number): string {
  return fmtUsd(cents / 100);
}
