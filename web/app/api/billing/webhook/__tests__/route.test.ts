import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { POST } from '@/app/api/billing/webhook/route';
import { paddle } from '@/lib/paddle';

vi.mock('@/lib/paddle', () => ({
  paddle: {
    webhooks: {
      unmarshal: vi.fn(),
    },
  },
}));

const updateUserTierMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/adapters', () => ({
  SupabasePersistenceAdapter: class {
    updateUserTier = updateUserTierMock;
  },
}));

process.env.PADDLE_WEBHOOK_SECRET = 'test-secret';

function event(overrides: Record<string, unknown>) {
  return {
    event_type: 'subscription.created',
    data: {
      id: 'sub_1',
      status: 'active',
      custom_data: { userId: 'user_1' },
      items: [{ price: { id: 'pri_01m0azkzf40rxr0s09dacy1bqc' } }],
      ...overrides,
    },
  };
}

function post(body: unknown) {
  return POST(new NextRequest('https://hex-yt-intel.vercel.app/api/billing/webhook', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

describe('LEGACY /api/billing/webhook — shared price→tier mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a Light price to tier light (never hardcoded pro)', async () => {
    vi.mocked(paddle.webhooks.unmarshal).mockReturnValue(event({}) as never);
    const res = await post({});
    expect(res.status).toBe(200);
    expect(updateUserTierMock).toHaveBeenCalledWith({ userId: 'user_1', tier: 'light' });
  });

  it('canceled subscription resets tier to free', async () => {
    vi.mocked(paddle.webhooks.unmarshal).mockReturnValue(
      event({ status: 'canceled', items: [{ price: { id: 'pri_unknown' } }] }) as never
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(updateUserTierMock).toHaveBeenCalledWith({ userId: 'user_1', tier: 'free' });
  });

  it('fails closed (400) on an unrecognised price ID', async () => {
    vi.mocked(paddle.webhooks.unmarshal).mockReturnValue(
      event({ items: [{ price: { id: 'pri_totally_unknown' } }] }) as never
    );
    const res = await post({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unrecognised price ID');
  });
});
