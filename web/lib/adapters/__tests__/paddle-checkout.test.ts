import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaddleBillingAdapter } from '../PaddleBillingAdapter';
import { paddle } from '@/lib/paddle';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/billing/checkout/route';
import * as supabaseAuth from '@/lib/supabase';

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

vi.mock('@/lib/config/pricing', () => ({
  resolvePriceId: vi.fn().mockResolvedValue('pri_test_123'),
}));

describe('PaddleBillingAdapter & Checkout Flow', () => {
  let adapter: PaddleBillingAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PADDLE_PRO_PRICE_ID = 'pri_pro_monthly_123';
    process.env.PADDLE_FOUNDER_PRICE_ID = 'pri_founder_123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hex-yt-intel.vercel.app';
    adapter = new PaddleBillingAdapter();
  });

  it('Test 1: Unauthenticated request rejected with 401 on checkout route', async () => {
    vi.mocked(supabaseAuth.getSupabaseClientWithAuth).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as any);

    const req = new NextRequest('https://hex-yt-intel.vercel.app/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        plan: 'pro',
        interval: 'month',
        successUrl: 'https://hex-yt-intel.vercel.app/billing?success=true',
        cancelUrl: 'https://hex-yt-intel.vercel.app/pricing?canceled=true',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('Test 2: Unknown plan tier throws invalid contract error', async () => {
    await expect(
      adapter.createCheckoutSession('user-123', 'user@example.com', 'unknown' as any)
    ).rejects.toThrow('Invalid plan tier: unknown');

    await expect(
      adapter.createCheckoutSession('user-123', 'user@example.com', 'free' as any)
    ).rejects.toThrow('Cannot create checkout session for free tier');
  });

  it('Test 3: Valid founder tier creates checkout URL with verified passthrough userId', async () => {
    const mockTx = {
      id: 'tx_founder_test_999',
      checkout: {
        url: 'https://sandbox-checkout.paddle.com/checkout/tx_founder_test_999',
      },
    };
    vi.mocked(paddle.transactions.create).mockResolvedValue(mockTx as any);

    const result = await adapter.createCheckoutSession('user-777', 'founder@example.com', 'founder');

    expect(paddle.transactions.create).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_founder_123', quantity: 1 }],
      customData: {
        userId: 'user-777',
        planTier: 'founder',
      },
    });

    expect(result.checkoutUrl).toBe('https://sandbox-checkout.paddle.com/checkout/tx_founder_test_999');
  });
});
