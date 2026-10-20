import { NextRequest } from 'next/server';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { POST } from '../route';

const getUser = vi.fn();
const mockSupabase = {
  auth: { getUser },
  from: vi.fn(),
};

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/adapters/DubShortLinkAdapter', () => ({
  DubShortLinkAdapter: {
    createShortLink: vi.fn().mockResolvedValue('https://vintel.link/test123'),
  },
}));

describe('POST /api/analyses/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const req = new NextRequest('http://localhost/api/analyses/123/share', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: '123' }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when analysis does not exist for the authenticated user', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const mockMaybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const mockEqUser = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEqId = vi.fn().mockReturnValue({ eq: mockEqUser });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqId });

    mockSupabase.from.mockReturnValueOnce({ select: mockSelect });

    const req = new NextRequest('http://localhost/api/analyses/123/share', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: '123' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});
