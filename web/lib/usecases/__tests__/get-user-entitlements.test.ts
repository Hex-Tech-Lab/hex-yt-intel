import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetUserEntitlementsUseCase } from '../GetUserEntitlementsUseCase';
import * as supabaseModule from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

describe('GetUserEntitlementsUseCase', () => {
  let useCase: GetUserEntitlementsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    useCase = new GetUserEntitlementsUseCase();
  });

  it('Test 1: Non-existent subscription defaults to free entitlements', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(mockSupabase as any);

    const entitlements = await useCase.execute('user-free-123');

    expect(entitlements).toEqual({
      tier: 'free',
      is_founder: false,
      is_enterprise: false,
      is_unlimited: false,
      canAnalyzeVideo: true,
      canAccessKnowledgeGraph: false,
      canUseExtendedChat: false,
      canExportKnowledgeGraph: false,
    });
  });

  it('Test 2: Active founder subscription unlocks Pro features', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    plan_tier: 'founder',
                    status: 'active',
                    current_period_end: new Date(Date.now() + 86400000).toISOString(),
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(mockSupabase as any);

    const entitlements = await useCase.execute('user-founder-456');

    expect(entitlements).toEqual({
      tier: 'founder',
      is_founder: true,
      is_enterprise: false,
      is_unlimited: false,
      canAnalyzeVideo: true,
      canAccessKnowledgeGraph: true,
      canUseExtendedChat: true,
      canExportKnowledgeGraph: true,
    });
  });

  it('Test 3: Past-due or canceled subscription falls back to free limits', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    plan_tier: 'pro',
                    status: 'past_due',
                    current_period_end: new Date(Date.now() - 86400000).toISOString(),
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(mockSupabase as any);

    const entitlements = await useCase.execute('user-pro-pastdue');

    expect(entitlements).toEqual({
      tier: 'free',
      is_founder: false,
      is_enterprise: false,
      is_unlimited: false,
      canAnalyzeVideo: true,
      canAccessKnowledgeGraph: false,
      canUseExtendedChat: false,
      canExportKnowledgeGraph: false,
    });
  });

  describe('founder allowlist (regression: 2026-09-05 hardcoded /kelly/i bypass removal)', () => {
    const noSubscriptionSupabase = () => ({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });

    it('grants founder tier to an ID in FOUNDER_USER_IDS (exact match)', async () => {
      vi.stubEnv('FOUNDER_USER_IDS', 'owner-uuid-123');
      vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(noSubscriptionSupabase() as any);

      const entitlements = await useCase.execute('owner-uuid-123');

      expect(entitlements.tier).toBe('founder');
      expect(entitlements.is_founder).toBe(true);
      expect(entitlements.is_unlimited).toBe(true);
      vi.unstubAllEnvs();
    });

    it('grants founder tier to an email in ADMIN_FOUNDER_EMAILS (exact match)', async () => {
      vi.stubEnv('ADMIN_FOUNDER_EMAILS', 'kellybakri@gmail.com');
      vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(noSubscriptionSupabase() as any);

      const entitlements = await useCase.execute('some-user-id', 'kellybakri@gmail.com');

      expect(entitlements.tier).toBe('founder');
      vi.unstubAllEnvs();
    });

    it('does NOT grant founder tier to an email merely containing "kelly" (the removed regex bypass)', async () => {
      vi.stubEnv('ADMIN_FOUNDER_EMAILS', 'kellybakri@gmail.com');
      vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(noSubscriptionSupabase() as any);

      const entitlements = await useCase.execute('random-user-id', 'kelly.smith@randomcompany.com');

      expect(entitlements.tier).toBe('free');
      expect(entitlements.is_founder).toBe(false);
      vi.unstubAllEnvs();
    });

    it('does NOT grant founder tier when FOUNDER_USER_IDS/ADMIN_FOUNDER_EMAILS are unset (no silent fallback)', async () => {
      vi.stubEnv('FOUNDER_USER_IDS', '');
      vi.stubEnv('ADMIN_FOUNDER_EMAILS', '');
      vi.mocked(supabaseModule.getSupabaseServiceClient).mockReturnValue(noSubscriptionSupabase() as any);

      const entitlements = await useCase.execute('da4381c6-f774-4c99-8f04-2c1c9e27d1fb', 'kellybakri@gmail.com');

      expect(entitlements.tier).toBe('free');
      vi.unstubAllEnvs();
    });
  });
});
