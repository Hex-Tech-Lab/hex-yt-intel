/** Shared endpoint type for quota checking gates. */
export type QuotaEndpoint = 'analyses' | 'search' | 'checkout';

/** Result of a quota gate check. */
export interface QuotaGateResult {
  /** true = request may proceed; false = request is denied. */
  allowed: boolean;
  /** Rate-limit headers to attach to the success response when allowed. */
  headers?: Record<string, string>;
}