// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/comments/runs/[analysisId]/route';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ID = '650e8400-e29b-41d4-a716-446655440000';

const runRow = {
  id: 'run-1',
  status: 'completed',
  mode: 'cochran',
  sampled_count: 420,
  created_at: '2026-09-30T00:00:00Z',
  completed_at: '2026-09-30T00:05:00Z',
};

const fromChain = vi.fn();
const getUser = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(async () => ({
    auth: { getUser },
    from: fromChain,
  })),
}));

function mockQuery(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  fromChain.mockReturnValue(builder);
  return builder;
}

function get(id: string): Promise<Response> {
  return GET(new NextRequest('http://localhost'), { params: Promise.resolve({ analysisId: id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/comments/runs/[analysisId]', () => {
  it('returns 401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await get(ANALYSIS_ID);
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-uuid analysisId', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await get('not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns null run for another user\'s analysis (ownership-scoped query)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const builder = mockQuery({ data: null, error: null });
    const res = await get(OTHER_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    // Ownership enforced in the query itself: user_id + analysis_id filters.
    const eqCalls = builder.eq.mock.calls.map((c) => c[0]);
    expect(eqCalls).toContain('user_id');
    expect(eqCalls).toContain('analysis_id');
  });

  it('returns the latest run row on the happy path', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockQuery({ data: runRow, error: null });
    const res = await get(ANALYSIS_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ id: 'run-1', status: 'completed', mode: 'cochran', sampled_count: 420 });
  });

  it('returns 500 when the query errors', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockQuery({ data: null, error: { message: 'db down' } });
    const res = await get(ANALYSIS_ID);
    expect(res.status).toBe(500);
  });
});
