import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
}));

vi.mock('@/lib/usecases/GetUserEntitlementsUseCase', () => ({
  GetUserEntitlementsUseCase: function() {
    return {
      execute: vi.fn().mockResolvedValue({
        tier: 'founder',
        canAnalyzeVideo: true,
        canAccessKnowledgeGraph: true,
        canUseExtendedChat: true,
      }),
    };
  },
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { GET } from '@/app/api/billing/entitlements/route';

describe('GET /api/billing/entitlements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when user is not authenticated', async () => {
    const { getSupabaseClientWithAuth } = await import('@/lib/supabase');
    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });

    const req = new NextRequest('http://localhost/api/billing/entitlements');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 200 with entitlements for an authenticated user', async () => {
    const { getSupabaseClientWithAuth } = await import('@/lib/supabase');
    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user_123' } }, error: null }) },
    });

    const req = new NextRequest('http://localhost/api/billing/entitlements');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.entitlements.tier).toBe('founder');
  });

  it('returns 503 when an internal error occurs (prevents caching outage as Free)', async () => {
    const { getSupabaseClientWithAuth } = await import('@/lib/supabase');
    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection failed'));

    const req = new NextRequest('http://localhost/api/billing/entitlements');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});
