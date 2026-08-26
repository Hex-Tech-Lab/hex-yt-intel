import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GET } from '@/app/api/billing/entitlements/route';
import { POST as checkoutHandler } from '@/app/api/billing/checkout/route';
import { POST as webhookHandler } from '@/app/api/webhooks/paddle/route';
import { paddle } from '@/lib/paddle';
import * as supabaseAuth from '@/lib/supabase';

// Mock Supabase service client
const mockDb = new Map<string, any>();

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
  getSupabaseServiceClient: vi.fn().mockImplementation(() => ({
    from: (table: string) => {
      if (table === 'user_subscriptions') {
        return {
          select: vi.fn().mockImplementation((cols: string) => ({
            eq: vi.fn().mockImplementation((col: string, val: string) => ({
              maybeSingle: vi.fn().mockImplementation(() => {
                const row = mockDb.get(val);
                return { data: row || null, error: null };
              }),
              in: vi.fn().mockImplementation((inCol: string, statuses: string[]) => ({
                order: vi.fn().mockImplementation(() => {
                  const rows = Array.from(mockDb.values()).filter(
                    (entitlementResponse) => entitlementResponse.user_id === val && statuses.includes(entitlementResponse.status)
                  );
                  return { data: rows, error: null };
                }),
              })),
            })),
          })),
          upsert: vi.fn().mockImplementation((record: any) => {
            mockDb.set(record.paddle_subscription_id, record);
            return { error: null };
          }),
        };
      }
      if (table === 'usage_logs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    },
  })),
}));

vi.mock('@/lib/paddle', () => ({
  paddle: {
    transactions: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('Paddle MoR End-to-End Billing Lifecycle', () => {
  const userId = 'e2e-user-456';
  const userEmail = 'founder-buyer@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.clear();
    process.env.PADDLE_PRO_PRICE_ID = 'pri_pro_live_123';
    process.env.PADDLE_FOUNDER_PRICE_ID = 'pri_founder_live_456';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.hex-yt-intel.com';
    process.env.PADDLE_WEBHOOK_SECRET = 'secret_test_webhook_key';
  });

  it('Full Cycle: Pricing -> Checkout -> Webhook (transaction.completed) -> Entitlements (200 Founder)', async () => {
    // 1. Initial State: User is Free tier
    vi.mocked(supabaseAuth.getSupabaseClientWithAuth).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId, email: userEmail } }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    } as any);

    const initialEntitlementsRes = await GET(new NextRequest('https://app.hex-yt-intel.com/api/billing/entitlements'));
    expect(initialEntitlementsRes.status).toBe(200);
    const initialEntitlements = await initialEntitlementsRes.json();
    expect(initialEntitlements.entitlements.tier).toBe('free');
    expect(initialEntitlements.entitlements.canAccessKnowledgeGraph).toBe(false);

    // 2. Checkout: User clicks "Upgrade to Founder"
    const mockPaddleCreate = vi.mocked(paddle.transactions.create);
    mockPaddleCreate.mockResolvedValue({
      id: 'txn_e2e_founder_001',
      checkout: { url: 'https://checkout.paddle.com/checkout/tx_txn_e2e_founder_001' },
    } as any);

    const checkoutReq = new NextRequest('https://app.hex-yt-intel.com/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        plan: 'founder',
        interval: 'once',
        successUrl: 'https://app.hex-yt-intel.com/success',
        cancelUrl: 'https://app.hex-yt-intel.com/pricing',
      }),
    });

    const checkoutRes = await checkoutHandler(checkoutReq);
    expect(checkoutRes.status).toBe(200);
    const checkoutBody = await checkoutRes.json();
    expect(checkoutBody.sessionUrl).toBe('https://checkout.paddle.com/checkout/tx_txn_e2e_founder_001');

    expect(mockPaddleCreate).toHaveBeenCalledWith(expect.objectContaining({ customData: { userId, planTier: 'founder' } }));

    // 3. Webhook: Paddle sends transaction.completed
    const webhookPayload = {
      event_id: 'evt_txn_comp_001',
      event_type: 'transaction.completed',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'txn_e2e_founder_001',
        customer_id: 'ctm_999',
        status: 'completed',
        custom_data: {
          user_id: userId,
          plan_tier: 'founder',
        },
        items: [
          {
            price: {
              id: 'pri_founder_live_456',
              billing_cycle: { interval: 'once' },
              custom_data: { plan_tier: 'founder' },
            },
          },
        ],
      },
    };

    const rawBody = JSON.stringify(webhookPayload);
    // Generate valid h1 signature
    const crypto = await import('crypto');
    const ts = Math.floor(Date.now() / 1000).toString();
    const h1 = crypto.createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET!).update(`${ts}:${rawBody}`).digest('hex');
    const signatureHeader = `ts=${ts};h1=${h1}`;

    const webhookReq = new NextRequest('https://app.hex-yt-intel.com/api/webhooks/paddle', {
      method: 'POST',
      headers: {
        'paddle-signature': signatureHeader,
      },
      body: rawBody,
    });

    const webhookRes = await webhookHandler(webhookReq);
    expect(webhookRes.status).toBe(200);

    // 4. Verification: Entitlements now resolve Founder tier
    const finalEntitlementsRes = await GET(new NextRequest('https://app.hex-yt-intel.com/api/billing/entitlements'));
    expect(finalEntitlementsRes.status).toBe(200);
    const finalEntitlements = await finalEntitlementsRes.json();
    expect(finalEntitlements.entitlements.tier).toBe('founder');
    expect(finalEntitlements.entitlements.canAccessKnowledgeGraph).toBe(true);
    expect(finalEntitlements.entitlements.canUseExtendedChat).toBe(true);
  });
});
