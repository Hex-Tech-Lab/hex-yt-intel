import { describe, it, expect } from 'vitest';
import { validateCochranSamplingConfig, type CochranSamplingConfig } from '@/lib/config/comments-sampling-config';

const VALID: CochranSamplingConfig = {
  syncPoolMaxPages: 10, recencyPoolMaxPages: 10, likeBucketCount: 3, recencyBucketCount: 3,
  cochran: { zScore: 1.96, marginOfError: 0.05, pEstimate: 0.5 },
  minConfidence: 0.5, classifierConcurrency: 8, classifierRequestTimeoutMs: 15000,
};

describe('validateCochranSamplingConfig', () => {
  it('accepts the registry defaults', () => {
    expect(validateCochranSamplingConfig(VALID).ok).toBe(true);
  });
  it.each([
    ['zero page cap (was silently coerced from a bad value)', { ...VALID, syncPoolMaxPages: 0 }],
    ['NaN', { ...VALID, recencyPoolMaxPages: Number.NaN }],
    ['non-integer bucket count', { ...VALID, likeBucketCount: 2.5 }],
    ['zero margin of error', { ...VALID, cochran: { ...VALID.cochran, marginOfError: 0 } }],
    ['string instead of number', { ...VALID, classifierConcurrency: '8' as unknown as number }],
    ['missing cochran block', { ...VALID, cochran: undefined as unknown as CochranSamplingConfig['cochran'] }],
  ])('rejects %s', (_label, config) => {
    const result = validateCochranSamplingConfig(config);
    expect(result.ok).toBe(false);
  });
});
