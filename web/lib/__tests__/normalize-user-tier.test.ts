import { describe, expect, it } from 'vitest';

import { USER_TIERS, isPaidTier, normalizeUserTier } from '@/lib/types/billing';

describe('normalizeUserTier', () => {
  it.each(USER_TIERS)('maps valid tier %s to itself', (tier) => {
    expect(normalizeUserTier(tier)).toBe(tier);
  });

  it.each(['founder', 'admin', 'PRO', ' pro', 'pro ', '', 'Free', 'null'])(
    'fails closed to free for unexpected string %s',
    (value) => {
      expect(normalizeUserTier(value)).toBe('free');
    },
  );

  it.each([null, undefined, 42, 0, true, {}, [], ['pro']])(
    'fails closed to free for non-string %s',
    (value) => {
      expect(normalizeUserTier(value)).toBe('free');
    },
  );
});

describe('isPaidTier', () => {
  it('is false only for free', () => {
    expect(isPaidTier('free')).toBe(false);
    for (const tier of USER_TIERS) {
      if (tier === 'free') continue;
      expect(isPaidTier(tier)).toBe(true);
    }
  });
});
