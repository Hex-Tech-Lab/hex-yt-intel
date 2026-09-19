import { describe, it, expect } from 'vitest';
import { CheckoutSchema } from '../contracts';

process.env.NEXT_PUBLIC_APP_URL = 'https://hex-yt-intel.vercel.app';

const base = {
  successUrl: 'https://hex-yt-intel.vercel.app/billing?success=true',
  cancelUrl: 'https://hex-yt-intel.vercel.app/pricing?canceled=true',
};

describe('CheckoutSchema — canonical tier vocabulary', () => {
  it('accepts light/month, light/year, pro/month, max/month, max/year', () => {
    for (const [plan, interval] of [
      ['light', 'month'],
      ['light', 'year'],
      ['pro', 'month'],
      ['max', 'month'],
      ['max', 'year'],
    ] as const) {
      const result = CheckoutSchema.safeParse({ ...base, plan, interval });
      expect(result.success, `${plan}/${interval} should parse`).toBe(true);
    }
  });

  it('rejects founder with a recurring interval (founder is once-only)', () => {
    expect(CheckoutSchema.safeParse({ ...base, plan: 'founder', interval: 'month' }).success).toBe(false);
  });

  it('rejects one-time intervals for subscription tiers (fail closed)', () => {
    expect(CheckoutSchema.safeParse({ ...base, plan: 'light', interval: 'once' }).success).toBe(false);
    expect(CheckoutSchema.safeParse({ ...base, plan: 'max', interval: 'once' }).success).toBe(false);
  });

  it('rejects an unknown plan string (fail closed, no silent default)', () => {
    expect(CheckoutSchema.safeParse({ ...base, plan: 'enterprise', interval: 'month' }).success).toBe(false);
    expect(CheckoutSchema.safeParse({ ...base, plan: 'garbage', interval: 'month' }).success).toBe(false);
  });
});
