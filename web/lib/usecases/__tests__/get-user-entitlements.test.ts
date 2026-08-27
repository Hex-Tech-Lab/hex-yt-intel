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
});
