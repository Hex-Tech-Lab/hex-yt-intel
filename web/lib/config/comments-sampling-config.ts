/**
 * Validation for the settings a cochran comment run carries (#378 review P2).
 * Shared by the Vercel producer (refuses to enqueue a bad config) and the
 * worker consumer (re-checks at its boundary). A missing, non-finite,
 * non-integer or out-of-range value is an error -- never coerced to 0.
 * Ranges match the Settings Registry validation bounds.
 */
export interface CochranSamplingConfig {
  syncPoolMaxPages: number;
  recencyPoolMaxPages: number;
  likeBucketCount: number;
  recencyBucketCount: number;
  cochran: { zScore: number; marginOfError: number; pEstimate: number };
  minConfidence: number;
  classifierConcurrency: number;
  classifierRequestTimeoutMs: number;
}

type Rule = { path: string; get: (config: CochranSamplingConfig) => unknown; min: number; max: number; integer: boolean; exclusiveMin?: boolean };

const RULES: Rule[] = [
  { path: 'syncPoolMaxPages', get: (config) => config.syncPoolMaxPages, min: 1, max: 50, integer: true },
  { path: 'recencyPoolMaxPages', get: (config) => config.recencyPoolMaxPages, min: 1, max: 50, integer: true },
  { path: 'likeBucketCount', get: (config) => config.likeBucketCount, min: 1, max: 10, integer: true },
  { path: 'recencyBucketCount', get: (config) => config.recencyBucketCount, min: 1, max: 10, integer: true },
  { path: 'cochran.zScore', get: (config) => config.cochran?.zScore, min: 0, max: 5, integer: false, exclusiveMin: true },
  { path: 'cochran.marginOfError', get: (config) => config.cochran?.marginOfError, min: 0, max: 0.5, integer: false, exclusiveMin: true },
  { path: 'cochran.pEstimate', get: (config) => config.cochran?.pEstimate, min: 0, max: 1, integer: false, exclusiveMin: true },
  { path: 'minConfidence', get: (config) => config.minConfidence, min: 0, max: 1, integer: false },
  { path: 'classifierConcurrency', get: (config) => config.classifierConcurrency, min: 1, max: 32, integer: true },
  { path: 'classifierRequestTimeoutMs', get: (config) => config.classifierRequestTimeoutMs, min: 1000, max: 60000, integer: true },
];

export function validateCochranSamplingConfig(candidate: unknown): { ok: true; config: CochranSamplingConfig } | { ok: false; errors: string[] } {
  if (candidate === null || typeof candidate !== 'object') return { ok: false, errors: ['sampling config missing'] };
  const config = candidate as CochranSamplingConfig;
  const errors: string[] = [];
  for (const rule of RULES) {
    const value = rule.get(config);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${rule.path} must be a finite number`);
    } else if (rule.integer && !Number.isInteger(value)) {
      errors.push(`${rule.path} must be an integer`);
    } else if ((rule.exclusiveMin ? value <= rule.min : value < rule.min) || value > rule.max) {
      errors.push(`${rule.path} must be in ${rule.exclusiveMin ? '(' : '['}${rule.min}, ${rule.max}]`);
    }
  }
  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}
