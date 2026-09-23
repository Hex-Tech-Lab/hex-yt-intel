import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveUserTierForPriceId, mapPlanStringToUserTier, PRICE_IDS_FALLBACK } from '@/lib/config/pricing';
import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';
import { SupabaseBillingAdapter } from '@/lib/adapters/SupabaseBillingAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn(),
  },
}));

const mockGetRegistrySettings = vi.mocked(SupabaseSettingsAdapter.getRegistrySettings);

function mockRegistry() {
  mockGetRegistrySettings.mockResolvedValue({
    'billing.priceIds': PRICE_IDS_FALLBACK,
  } as never);
}

// Minimal service-client mock: only `.from().upsert/.update/.eq/.select/.maybeSingle`
// shapes the subscription path touches are stubbed.
function makeSupabaseMock() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null, count: 1 }) });
  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });
  const from = vi.fn((table: string) => (table === 'users' ? { update } : { upsert, select }));
  return { from, upsert, update };
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { getSupabaseServiceClient } from '@/lib/supabase';

function subscriptionPayload(overrides: {
  priceId?: string;
  planTier?: string;
  status?: string;
}): unknown {
  return {
    event_type: 'subscription.created',
    occurred_at: '2026-09-19T00:00:00Z',
    data: {
      id: 'sub_123',
      customer_id: 'ctm_123',
      status: overrides.status ?? 'active',
      custom_data: { userId: 'user_1', ...(overrides.planTier ? { planTier: overrides.planTier } : {}) },
      items: [
        {
          price: {
            id: overrides.priceId,
            billing_cycle: { interval: 'month' },
            ...(overrides.planTier ? { custom_data: { plan_tier: overrides.planTier } } : {}),
          },
        },
      ],
      current_billing_period: { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' },
      scheduled_change: null,
    },
  };
}

describe('tier vocabulary (STEP 1 runtime path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PADDLE_PRO_PRICE_ID;
    mockRegistry();
  });

  it('compile-time exhaustiveness: UserTier covers exactly the canonical 5 values', async () => {
    const { UserTierSchemaForTest } = await import('./tier-vocabulary-exhaustive');
    expect(UserTierSchemaForTest).toEqual(['free', 'light', 'pro', 'max', 'enterprise']);
  });

  describe('resolveUserTierForPriceId', () => {
    it('maps Light monthly price to light', async () => {
      expect(await resolveUserTierForPriceId('pri_01m0azkzf40rxr0s09dacy1bqc')).toBe('light');
    });
    it('maps Light yearly price to light', async () => {
      expect(await resolveUserTierForPriceId('pri_01m0azkzqkrn72rkmrh7363a56')).toBe('light');
    });
    it('maps Max monthly price to max', async () => {
      expect(await resolveUserTierForPriceId('pri_01m0azm0gxd599sca4acw17vkp')).toBe('max');
    });
    it('maps Pro yearly price to pro', async () => {
      expect(await resolveUserTierForPriceId('pri_01m0azm06tqsbxxbm8nyqs2whq')).toBe('pro');
    });
    it('maps the PADDLE_PRO_PRICE_ID env override to pro', async () => {
      process.env.PADDLE_PRO_PRICE_ID = 'pri_env_pro_monthly';
      expect(await resolveUserTierForPriceId('pri_env_pro_monthly')).toBe('pro');
    });
    it('maps founder price IDs to pro (founder pricing is a price, not a tier)', async () => {
      expect(await resolveUserTierForPriceId('pri_01m0bjt2sv9qkr4jyq1kpfjgmt')).toBe('pro');
      expect(await resolveUserTierForPriceId('pri_01m0bjt33qc1njber48kx9ewtx')).toBe('pro');
    });
    it('fails closed on an unknown price ID (returns null, never pro)', async () => {
      expect(await resolveUserTierForPriceId('pri_totally_unknown')).toBeNull();
      expect(await resolveUserTierForPriceId(null)).toBeNull();
      expect(await resolveUserTierForPriceId(undefined)).toBeNull();
    });
  });

  describe('mapPlanStringToUserTier', () => {
    it('maps light/pro/max and founder->pro; fails closed on junk', () => {
      expect(mapPlanStringToUserTier('light')).toBe('light');
      expect(mapPlanStringToUserTier('pro')).toBe('pro');
      expect(mapPlanStringToUserTier('max')).toBe('max');
      expect(mapPlanStringToUserTier('founder')).toBe('pro');
      expect(mapPlanStringToUserTier('enterprise')).toBeNull();
      expect(mapPlanStringToUserTier('garbage')).toBeNull();
      expect(mapPlanStringToUserTier(undefined)).toBeNull();
    });
  });

  describe('PaddleBillingAdapter.processSubscriptionEvent', () => {
    it('grants light for a Light price', async () => {
      const supabase = makeSupabaseMock();
      vi.mocked(getSupabaseServiceClient).mockReturnValue(supabase as never);
      const updateUserTier = vi.spyOn(SupabaseBillingAdapter, 'updateUserTier').mockResolvedValue();

      const adapter = new PaddleBillingAdapter();
      const result = await adapter.processSubscriptionEvent(subscriptionPayload({ priceId: 'pri_01m0azkzf40rxr0s09dacy1bqc' }) as never);

      expect(result.success).toBe(true);
      expect(updateUserTier).toHaveBeenCalledWith({ userId: 'user_1', tier: 'light' });
      // DB-CHECK clamp: subscriptions column stays in ('free','founder','pro')
      expect(supabase.upsert.mock.calls[0][0].plan_tier).toBe('pro');
    });

    it('grants max for a Max price', async () => {
      const supabase = makeSupabaseMock();
      vi.mocked(getSupabaseServiceClient).mockReturnValue(supabase as never);
      const updateUserTier = vi.spyOn(SupabaseBillingAdapter, 'updateUserTier').mockResolvedValue();

      const adapter = new PaddleBillingAdapter();
      const result = await adapter.processSubscriptionEvent(subscriptionPayload({ priceId: 'pri_01m0azm0gxd599sca4acw17vkp' }) as never);

      expect(result.success).toBe(true);
      expect(updateUserTier).toHaveBeenCalledWith({ userId: 'user_1', tier: 'max' });
    });

    it('canceled event resets tier to free without requiring a known price', async () => {
      const supabase = makeSupabaseMock();
      vi.mocked(getSupabaseServiceClient).mockReturnValue(supabase as never);
      const updateUserTier = vi.spyOn(SupabaseBillingAdapter, 'updateUserTier').mockResolvedValue();

      const adapter = new PaddleBillingAdapter();
      const result = await adapter.processSubscriptionEvent(
        subscriptionPayload({ status: 'canceled', priceId: 'pri_01m0azkzf40rxr0s09dacy1bqc' }) as never
      );

      expect(result.success).toBe(true);
      expect(updateUserTier).toHaveBeenCalledWith({ userId: 'user_1', tier: 'free' });
    });

    it('FAILS CLOSED on an unknown price: tier unchanged, error returned, Sentry captured', async () => {
      const supabase = makeSupabaseMock();
      vi.mocked(getSupabaseServiceClient).mockReturnValue(supabase as never);
      const updateUserTier = vi.spyOn(SupabaseBillingAdapter, 'updateUserTier').mockResolvedValue();
      const { captureMessage } = await import('@sentry/nextjs');

      const adapter = new PaddleBillingAdapter();
      const result = await adapter.processSubscriptionEvent(subscriptionPayload({ priceId: 'pri_unknown' }) as never);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unrecognised price');
      expect(updateUserTier).not.toHaveBeenCalled();
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(captureMessage).toHaveBeenCalled();
    });

    // Negative control (2026-09-24 round 2, P1): unrecognised price + forged
    // custom_data planTier "max" must NOT grant max (fallback removed).
    it('ignores custom_data planTier "max" on an unrecognised price (no fallback)', async () => {
      const supabase = makeSupabaseMock();
      vi.mocked(getSupabaseServiceClient).mockReturnValue(supabase as never);
      const updateUserTier = vi.spyOn(SupabaseBillingAdapter, 'updateUserTier').mockResolvedValue();

      const adapter = new PaddleBillingAdapter();
      const result = await adapter.processSubscriptionEvent(
        subscriptionPayload({ priceId: 'pri_unknown', planTier: 'max' }) as never
      );

      expect(result.success).toBe(false);
      expect(updateUserTier).not.toHaveBeenCalled();
      expect(supabase.upsert).not.toHaveBeenCalled();
    });
  });
});
