import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PaddleBillingAdapter } from '../PaddleBillingAdapter';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'transaction.completed',
    data: {
      id: 'txn_test_001',
      customer_id: 'cust_123',
      custom_data: { user_id: 'user_abc', plan_tier: 'founder' },
      items: [
        { price: { billing_cycle: { interval: 'once' }, custom_data: { plan_tier: 'founder' } } },
      ],
      ...overrides,
    },
  };
}

describe('PaddleBillingAdapter — recurring transaction guard', () => {
  const adapter = new PaddleBillingAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provisions lifetime access for a genuine once-interval founder transaction', async () => {
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ upsert: mockUpsert }),
    });

    // @ts-expect-error test payload shape
    const result = await adapter.processTransactionEvent(makePayload());
    expect(result.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledOnce();
    const row = mockUpsert.mock.calls[0]![0] as Record<string, unknown>;
    const endDate = new Date(row.current_period_end as string);
    const yearsAhead = (endDate.getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000);
    expect(yearsAhead).toBeGreaterThan(90);
  });

  it('SKIPS lifetime provisioning for a recurring Pro transaction.completed (has subscription_id)', async () => {
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    (getSupabaseServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ upsert: mockUpsert }),
    });

    const recurringPayload = makePayload({
      subscription_id: 'sub_recurring_001',
      items: [
        { price: { billing_cycle: { interval: 'month' }, custom_data: { plan_tier: 'pro' } } },
      ],
      custom_data: { user_id: 'user_abc', plan_tier: 'pro' },
    });

    // @ts-expect-error test payload shape
    const result = await adapter.processTransactionEvent(recurringPayload);
    expect(result.success).toBe(true);
    // Recurring renewal must NOT touch the DB
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
