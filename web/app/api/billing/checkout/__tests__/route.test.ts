import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { paddle } from '@/lib/paddle';
import { POST } from '@/app/api/billing/checkout/route';
import * as supabaseAuth from '@/lib/supabase';
import { SupabaseBillingAdapter } from '@/lib/adapters/SupabaseBillingAdapter';

vi.mock('@/lib/paddle', () => ({
  paddle: {
    transactions: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/services/traffic', () => ({
  guardTraffic: vi.fn().mockResolvedValue({ allowed: true }),
  getUserTier: vi.fn().mockResolvedValue('free'),
}));

// Per-tier mock (Cubic review, 2026-09-24): a flat "always light" mock let a
// Max→Light price regression pass the suite; each tier must resolve to its
// own price ID.
vi.mock('@/lib/config/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/pricing')>();
  return {
    ...actual,
    resolvePriceId: vi.fn().mockImplementation((plan: string) => {
      if (plan === 'light') return Promise.resolve('pri_light_test');
      if (plan === 'max') return Promise.resolve('pri_max_test');
      return Promise.resolve(null);
    }),
  };
});

vi.mock('@/lib/billing-factory', () => ({
  getBillingProvider: vi.fn().mockReturnValue({ type: 'paddle', createCheckout: vi.fn() }),
}));

const AUTHED_USER = { id: 'user_light_1', email: 'light@example.com' };

function mockAuth() {
  vi.mocked(supabaseAuth.getSupabaseClientWithAuth).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTHED_USER } }) },
    from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  } as never);
}

function checkoutRequest(plan: string, interval: string) {
  return new NextRequest('https://hex-yt-intel.vercel.app/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan,
      interval,
      successUrl: 'https://hex-yt-intel.vercel.app/billing?success=true',
      cancelUrl: 'https://hex-yt-intel.vercel.app/pricing?canceled=true',
    }),
  });
}

describe('POST /api/billing/checkout — canonical tier vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://hex-yt-intel.vercel.app';
    delete process.env.PADDLE_PRO_PRICE_ID;
    delete process.env.PADDLE_PRO_ANNUAL_PRICE_ID;
    mockAuth();
  });

  it('creates a Light checkout with the light price ID and light planTier custom data', async () => {
    vi.mocked(paddle.transactions.create).mockResolvedValue({
      id: 'tx_light_1',
      checkout: { url: 'https://sandbox-checkout.paddle.com/checkout/tx_light_1' },
    } as never);

    const res = await POST(checkoutRequest('light', 'month'));
    expect(res.status).toBe(200);
    expect(paddle.transactions.create).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_light_test', quantity: 1 }],
      customData: { userId: 'user_light_1', planTier: 'light' },
    });
  });

  it('creates a Max checkout with the max price ID and max planTier custom data', async () => {
    vi.mocked(paddle.transactions.create).mockResolvedValue({
      id: 'tx_max_1',
      checkout: { url: 'https://sandbox-checkout.paddle.com/checkout/tx_max_1' },
    } as never);

    const res = await POST(checkoutRequest('max', 'year'));
    expect(res.status).toBe(200);
    expect(paddle.transactions.create).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_max_test', quantity: 1 }],
      customData: { userId: 'user_light_1', planTier: 'max' },
    });
  });

  it('rejects a one-time Light purchase (fail closed, 400)', async () => {
    const res = await POST(checkoutRequest('light', 'once'));
    expect(res.status).toBe(400);
  });
});

describe('SupabaseBillingAdapter.updateUserTier — widened contract', () => {
  it('accepts the canonical light/max tiers without type narrowing', async () => {
    const serviceMock = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null, count: 1 }) }),
      }),
    };
    vi.mocked(supabaseAuth.getSupabaseServiceClient).mockReturnValue(serviceMock as never);

    await expect(SupabaseBillingAdapter.updateUserTier({ userId: 'u1', tier: 'light' })).resolves.toBeUndefined();
    await expect(SupabaseBillingAdapter.updateUserTier({ userId: 'u1', tier: 'max' })).resolves.toBeUndefined();
    expect(serviceMock.from('users').update).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'light' }),
      { count: 'exact' }
    );
  });
});
