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

  it.each(['free', 'light', 'pro', 'max', 'enterprise'] as const)(
    'passes through valid tier %s unchanged',
    async (dbTier) => {
      mockClient(dbTier);
      const identity = await new SupabaseAuthAdapter().authenticate();
      expect(identity?.tier).toBe(dbTier);
    },
  );

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

  it('uses getClaims fast-path when claims.sub is present without calling getUser', async () => {
    const getUserSpy = vi.fn();
    const getClaimsSpy = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: 'u-claims-1',
          email: 'claims@example.com',
        },
      },
      error: null,
    });
    const eqSpy = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { tier: 'pro' }, error: null }),
    });

    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getClaims: getClaimsSpy,
        getUser: getUserSpy,
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqSpy,
        }),
      }),
    });

    const identity = await new SupabaseAuthAdapter().authenticate();
    expect(getClaimsSpy).toHaveBeenCalledTimes(1);
    expect(getUserSpy).not.toHaveBeenCalled();
    expect(eqSpy).toHaveBeenCalledWith('id', 'u-claims-1');
    expect(identity).toEqual({
      userId: 'u-claims-1',
      email: 'claims@example.com',
      tier: 'pro',
    });
  });

  it('falls back to getUser when getClaims throws or returns no claims', async () => {
    const getUserSpy = vi.fn().mockResolvedValue({ data: { user: { id: 'u-claims-1', email: 'fallback@example.com' } } });
    const getClaimsSpy = vi.fn().mockRejectedValue(new Error('JWT validation failed'));
    const eqSpy = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { tier: 'max' }, error: null }),
    });

    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getClaims: getClaimsSpy,
        getUser: getUserSpy,
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqSpy,
        }),
      }),
    });

    const identity = await new SupabaseAuthAdapter().authenticate();
    expect(getClaimsSpy).toHaveBeenCalledTimes(1);
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('id', 'u-claims-1');
    expect(identity).toEqual({
      userId: 'u-claims-1',
      email: 'fallback@example.com',
      tier: 'max',
    });
  });

  it('forces active session validation via getUser when requireActiveSession is true', async () => {
    const getUserSpy = vi.fn().mockResolvedValue({ data: { user: { id: 'u-active-1', email: 'active@example.com' } } });
    const getClaimsSpy = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: 'u-claims-1',
          email: 'claims@example.com',
        },
      },
      error: null,
    });
    const eqSpy = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { tier: 'pro' }, error: null }),
    });

    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getClaims: getClaimsSpy,
        getUser: getUserSpy,
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqSpy,
        }),
      }),
    });

    const identity = await new SupabaseAuthAdapter().authenticate({ requireActiveSession: true });
    expect(getClaimsSpy).not.toHaveBeenCalled();
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(eqSpy).toHaveBeenCalledWith('id', 'u-active-1');
    expect(identity).toEqual({
      userId: 'u-active-1',
      email: 'active@example.com',
      tier: 'pro',
    });
  });
});
