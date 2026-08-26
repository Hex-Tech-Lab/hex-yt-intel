import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessPaddleWebhookUseCase } from '@/lib/usecases/ProcessPaddleWebhookUseCase';
import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';
import { GetUserEntitlementsUseCase } from '@/lib/usecases/GetUserEntitlementsUseCase';
import { CheckoutSchema } from '@/lib/types/contracts';

// Mock Supabase
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockSingle = vi.fn().mockResolvedValue({
  data: { plan_tier: 'founder', status: 'active' },
  error: null,
});
const mockLimit = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockSingle });
const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
const mockEq = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnThis(),
  order: mockOrder
});
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === 'user_subscriptions') {
        return { upsert: mockUpsert, select: mockSelect };
      }
      return {};
    }
  })
}));

describe('Founder Provisioning Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Step 1: Checkout request schema accepts founder tier and once interval', () => {
    const payload = {
      plan: 'founder',
      interval: 'once',
      successUrl: 'http://localhost/success',
      cancelUrl: 'http://localhost/cancel'
    };
    
    // Simulate setting NEXT_PUBLIC_APP_URL for validation
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
    const result = CheckoutSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('Step 2 & 3: Webhook handler processes transaction.completed and persists to DB', async () => {
    const adapter = new PaddleBillingAdapter();
    const useCase = new ProcessPaddleWebhookUseCase(adapter);

    // Mock verifySignature to always return true for testing
    vi.spyOn(adapter, 'verifySignature').mockReturnValue(true);

    const webhookPayload = {
      event_id: 'evt_123',
      event_type: 'transaction.completed',
      data: {
        id: 'txn_123',
        customer_id: 'ctm_123',
        status: 'completed',
        custom_data: {
          user_id: 'user_456',
          plan_tier: 'founder'
        },
        items: []
      }
    };

    const rawBody = JSON.stringify(webhookPayload);
    const result = await useCase.execute(rawBody, 'mock_sig', 'mock_secret');
    
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    // Verify DB persistence
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.user_id).toBe('user_456');
    expect(upsertArg.paddle_subscription_id).toBe('tx_txn_123'); // Prefix tx_
    expect(upsertArg.plan_tier).toBe('founder');
    expect(upsertArg.status).toBe('active');
  });

  it('Step 4: Entitlements API resolves founder features', async () => {
    const useCase = new GetUserEntitlementsUseCase();
    
    // The usecase will use our mocked select
    const entitlements = await useCase.execute('user_456');
    
    expect(entitlements.tier).toBe('founder');
    expect(entitlements.canAnalyzeVideo).toBe(true);
    expect(entitlements.canAccessKnowledgeGraph).toBe(true);
    expect(entitlements.canUseExtendedChat).toBe(true);
  });
});
