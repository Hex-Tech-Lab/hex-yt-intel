import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetUserEntitlementsUseCase } from '../GetUserEntitlementsUseCase';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

function makeSupabaseRows(rows: Array<{ plan_tier: string; status: string; current_period_end: string | null }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  };
}

describe('GetUserEntitlementsUseCase — expiry enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns free when the only active row has current_period_end in the past', async () => {
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabaseRows([
        { plan_tier: 'pro', status: 'active', current_period_end: '2020-01-01T00:00:00Z' },
      ])
    );

    const useCase = new GetUserEntitlementsUseCase();
    const result = await useCase.execute('user_123');
    expect(result.tier).toBe('free');
    expect(result.canAccessKnowledgeGraph).toBe(false);
  });

  it('returns the non-expired tier when one row is expired and one is valid', async () => {
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    const future = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabaseRows([
        { plan_tier: 'pro', status: 'active', current_period_end: '2020-01-01T00:00:00Z' },
        { plan_tier: 'founder', status: 'active', current_period_end: future },
      ])
    );

    const useCase = new GetUserEntitlementsUseCase();
    const result = await useCase.execute('user_123');
    expect(result.tier).toBe('founder');
    expect(result.canAccessKnowledgeGraph).toBe(true);
  });

  it('returns paid tier when current_period_end is null (lifetime/no-expiry)', async () => {
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeSupabaseRows([
        { plan_tier: 'founder', status: 'active', current_period_end: null },
      ])
    );

    const useCase = new GetUserEntitlementsUseCase();
    const result = await useCase.execute('user_123');
    expect(result.tier).toBe('founder');
  });
});
