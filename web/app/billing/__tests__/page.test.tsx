// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BillingPage from '../page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/components/organisms/ResponsiveHeader', () => ({
  ResponsiveHeader: () => <div data-testid="header" />,
}));

vi.mock('@/components/Footer', () => ({
  Footer: () => <div data-testid="footer" />,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { invoices: { list: vi.fn() } },
  STRIPE_PRICING: {
    free: { tier: 'free', name: 'Free', priceId: '', priceCents: 0, analysesPerMonth: 3 },
    pro: { tier: 'pro', name: 'Pro', priceId: 'price_pro', priceCents: 900, analysesPerMonth: null },
  },
}));

const AUTH_USER = { id: 'user_1', email: 'u@example.com' };

function supabaseMock(tier: string) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTH_USER } }) },
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'users' ? { id: 'user_1', email: 'u@example.com', name: 'U', tier, role: null, analyses_used: 1, stripe_customer_id: null } : null,
        error: null,
      }),
    })),
  };
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
}));

import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';

describe('BillingPage — canonical tier display', () => {
  it('renders a light-tier user as an active Light Plan (not Free)', async () => {
    const service = supabaseMock('light');
    vi.mocked(getSupabaseClientWithAuth).mockResolvedValue(service as never);
    vi.mocked(getSupabaseServiceClient).mockReturnValue(service as never);

    render(await BillingPage());
    expect(screen.getByText('Light Plan')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('renders a max-tier user as an active Max Plan', async () => {
    const service = supabaseMock('max');
    vi.mocked(getSupabaseClientWithAuth).mockResolvedValue(service as never);
    vi.mocked(getSupabaseServiceClient).mockReturnValue(service as never);

    render(await BillingPage());
    expect(screen.getByText('Max Plan')).toBeTruthy();
  });
});
