import { describe, it, expect } from 'vitest';
import { FULL_REPORT_TIERS } from '../route';

describe('FULL_REPORT_TIERS — canonical tier vocabulary', () => {
  it('grants full-report export to every paid tier', () => {
    for (const tier of ['pro', 'max', 'enterprise'] as const) {
      expect(FULL_REPORT_TIERS.has(tier), `${tier} should be permitted`).toBe(true);
    }
  });

  it('is digest-only for light (product decision 2026-09-24)', () => {
    expect(FULL_REPORT_TIERS.has('light')).toBe(false);
  });

  it('denies free tier', () => {
    expect(FULL_REPORT_TIERS.has('free')).toBe(false);
  });
});
