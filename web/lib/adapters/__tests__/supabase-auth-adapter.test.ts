import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseAuthAdapter } from '../SupabaseAuthAdapter';

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
}));

import { getSupabaseClientWithAuth } from '@/lib/supabase';

function mockClient(dbTier: unknown) {
  (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'u@x.com' } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { tier: dbTier }, error: null }),
        }),
      }),
    }),
  });
}

describe('SupabaseAuthAdapter.authenticate — fail-closed tier normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through a valid tier unchanged', async () => {
    mockClient('pro');
    const identity = await new SupabaseAuthAdapter().authenticate();
    expect(identity?.tier).toBe('pro');
  });

  it.each(['founder', 'admin', 'PRO', ' pro', '', null, undefined])(
    'normalizes unexpected DB tier %s to free',
    async (dbTier) => {
      mockClient(dbTier);
      const identity = await new SupabaseAuthAdapter().authenticate();
      expect(identity?.tier).toBe('free');
    },
  );

  it('returns free when the profile query errors', async () => {
    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'u@x.com' } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
          }),
        }),
      }),
    });
    const identity = await new SupabaseAuthAdapter().authenticate();
    expect(identity?.tier).toBe('free');
  });
});
