import * as crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaddleBillingAdapter } from '../PaddleBillingAdapter';
import { ProcessPaddleWebhookUseCase } from '../../usecases/ProcessPaddleWebhookUseCase';

// Mock Supabase
const mockUpsert = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: mockUpsert
    }))
  }))
}));

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn()
}));

function generateValidSignature(rawBody: string, secret: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${ts}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload);
  const h1 = hmac.digest('hex');
  return `ts=${ts};h1=${h1}`;
}

describe('PaddleBillingAdapter & UseCase Negative Controls', () => {
  const secret = 'test-secret';
  let adapter: PaddleBillingAdapter;
  let useCase: ProcessPaddleWebhookUseCase;

  beforeEach(() => {
    adapter = new PaddleBillingAdapter();
    useCase = new ProcessPaddleWebhookUseCase(adapter);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: Invalid/tampered webhook signature fails closed with 401', async () => {
    const rawBody = JSON.stringify({ event_id: 'evt_123', event_type: 'subscription.created', data: {} });
    const result = await useCase.execute(rawBody, 'ts=123;h1=invalid_hash', secret);
    
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toBe('Invalid signature');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('Test 2: Replayed webhook event with existing transaction ID executes idempotently', async () => {
    // We simulate idempotent behavior by returning no error from the upsert.
    mockUpsert.mockResolvedValueOnce({ error: null });

    const rawBody = JSON.stringify({
      event_id: 'evt_123',
      event_type: 'subscription.updated',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'sub_123',
        customer_id: 'ctm_123',
        status: 'active',
        custom_data: { user_id: 'user_123' },
        items: [{ price: { custom_data: { plan_tier: 'pro' } } }]
      }
    });

    const validSignature = generateValidSignature(rawBody, secret);
    
    const result = await useCase.execute(rawBody, validSignature, secret);
    
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // Call it again (replay)
    mockUpsert.mockResolvedValueOnce({ error: null });
    const replayResult = await useCase.execute(rawBody, validSignature, secret);
    
    expect(replayResult.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(2); // Upsert handles idempotency
  });

  it('Test 3: Valid subscription.created event correctly updates user tier to founder', async () => {
    mockUpsert.mockResolvedValueOnce({ error: null });

    const rawBody = JSON.stringify({
      event_id: 'evt_456',
      event_type: 'subscription.created',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'sub_456',
        customer_id: 'ctm_456',
        status: 'active',
        custom_data: { user_id: 'user_456' },
        items: [{ price: { custom_data: { plan_tier: 'founder' } } }]
      }
    });

    const validSignature = generateValidSignature(rawBody, secret);
    
    const result = await useCase.execute(rawBody, validSignature, secret);
    
    expect(result.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_456',
        paddle_customer_id: 'ctm_456',
        paddle_subscription_id: 'sub_456',
        plan_tier: 'founder',
        status: 'active'
      }),
      { onConflict: 'paddle_subscription_id' }
    );
  });
});
