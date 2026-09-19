import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PostgresBillingAdapter } from '../PostgresBillingAdapter';
import { SupabasePersistenceAdapter } from '../SupabasePersistenceAdapter';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn().mockResolvedValue({}),
  },
}));

describe('PostgresBillingAdapter.checkGate — canonical tier vocabulary', () => {
  let adapter: PostgresBillingAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PostgresBillingAdapter();
  });

  it('allows every paid tier (light/pro/max/enterprise) without a quota query', async () => {
    const getMonthly = vi.spyOn(SupabasePersistenceAdapter.prototype, 'getMonthlyAnalyses').mockResolvedValue([]);
    for (const tier of ['light', 'pro', 'max', 'enterprise'] as const) {
      const result = await adapter.checkGate({ userId: 'u1', tier, endpoint: 'analyses' });
      expect(result.allowed, `${tier} should be allowed`).toBe(true);
    }
    expect(getMonthly).not.toHaveBeenCalled();
  });

  it('free tier is quota-gated against the monthly count', async () => {
    vi.spyOn(SupabasePersistenceAdapter.prototype, 'getMonthlyAnalyses').mockResolvedValue([
      { id: 'a1', billingStatus: 'completed', createdAt: new Date().toISOString() },
      { id: 'a2', billingStatus: 'completed', createdAt: new Date().toISOString() },
      { id: 'a3', billingStatus: 'completed', createdAt: new Date().toISOString() },
    ]);
    const result = await adapter.checkGate({ userId: 'u1', tier: 'free', endpoint: 'analyses' });
    expect(result.allowed).toBe(false);
  });
});
