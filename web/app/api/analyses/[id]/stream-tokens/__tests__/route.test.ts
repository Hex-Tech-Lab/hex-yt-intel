/**
 * R3b 2.3.5c: POST /api/analyses/[id]/stream-tokens route contract
 * (auth, ownership, body validation, outcome → status mapping).
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticate = vi.fn();
const verifyResourceOwnership = vi.fn();
const findJevPlan = vi.fn();

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/adapters/SupabaseAuthAdapter', () => ({ SupabaseAuthAdapter: class { authenticate = authenticate; } }));
vi.mock('@/lib/services/ownership', () => ({ verifyResourceOwnership: (...args: unknown[]) => verifyResourceOwnership(...args) }));
vi.mock('@/lib/adapters/SupabasePersistenceAdapter', () => ({ SupabasePersistenceAdapter: class { findJevPlan = findJevPlan; } }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: vi.fn((_keys: string[], fallback: Record<string, unknown>) => Promise.resolve(fallback)) },
}));
vi.mock('@/lib/adapters', () => ({ SettingsModelAdapter: class { resolveModels = vi.fn().mockResolvedValue(['model-a']); } }));
vi.mock('@/lib/stream-token', () => ({ signStreamTokenV2: vi.fn().mockResolvedValue({ sig: 'f'.repeat(64), exp: 123 }) }));

import { POST } from '../route';

const OWNER = 'user-1';
const PLAN = {
  K: 2,
  streamCount: 9,
  truncatedFallback: false,
  cells: [
    ...[0, 1].flatMap((k) => [1, 2, 3, 4].map((chunkIndex) => ({
      jevChunkIndex: k, chunkIndex, startWord: k * 10, endWord: (k + 1) * 10, sha256: 'a'.repeat(64),
    }))),
    { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: 'b'.repeat(64) },
  ],
};

function call(body: unknown) {
  const req = new NextRequest('https://getvintel.com/api/analyses/an-1/stream-tokens', { method: 'POST', body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id: 'an-1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ userId: OWNER, email: 'o@example.com', tier: 'pro' });
  verifyResourceOwnership.mockResolvedValue({ data: { user_id: OWNER, video_id: 'vid' }, error: null });
  findJevPlan.mockResolvedValue(PLAN);
});

describe('POST /api/analyses/[id]/stream-tokens', () => {
  it('401 without a session', async () => {
    authenticate.mockResolvedValue(null);
    expect((await call({ cells: [{ jevChunkIndex: 0, chunkIndex: 1 }] })).status).toBe(401);
  });

  it('404 when the caller does not own the analysis', async () => {
    verifyResourceOwnership.mockResolvedValue({ data: { user_id: 'someone-else', video_id: 'vid' }, error: null });
    expect((await call({ cells: [{ jevChunkIndex: 0, chunkIndex: 1 }] })).status).toBe(404);
    expect(findJevPlan).not.toHaveBeenCalled();
  });

  it('400 for a malformed body, and for extra (forged) slice fields', async () => {
    expect((await call({ cells: [] })).status).toBe(400);
    expect((await call({ cells: [{ jevChunkIndex: -1, chunkIndex: 1 }] })).status).toBe(400);
    expect((await call({ cells: [{ jevChunkIndex: 0, chunkIndex: 1, startWord: 0, sliceSha256: 'c'.repeat(64) }] })).status).toBe(400);
  });

  it.each([
    [{ validation_report: { validation_status: 'done' }, billing_status: 'completed' }],
    [{ validation_report: { status: 'error' }, billing_status: 'failed' }],
    [{ validation_report: { validation_status: 'partial' }, billing_status: null }],
    [{ validation_report: { validation_status: 'processing' }, billing_status: 'completed' }],
  ])('409 not_processing for a settled analysis, without reading the plan (%#)', async (row) => {
    verifyResourceOwnership.mockResolvedValue({ data: { user_id: OWNER, video_id: 'vid', ...row }, error: null });
    const res = await call({ cells: [{ jevChunkIndex: 0, chunkIndex: 1 }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_processing' });
    expect(findJevPlan).not.toHaveBeenCalled();
  });

  it('400 naming a cell that is not in the stored plan', async () => {
    const res = await call({ cells: [{ jevChunkIndex: 7, chunkIndex: 1 }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_cell', cell: { jevChunkIndex: 7, chunkIndex: 1 } });
  });

  it.each([
    [null, 'no_plan'],
    [{ ...PLAN, K: 1, streamCount: 5 }, 'plan_k1'],
    [{ ...PLAN, truncatedFallback: true }, 'plan_truncated'],
  ])('409 when the stored plan cannot be minted (%#)', async (stored, error) => {
    findJevPlan.mockResolvedValue(stored);
    const res = await call({ cells: [{ jevChunkIndex: 0, chunkIndex: 1 }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error });
  });

  it('200 with one token per requested cell, fields from the stored plan', async () => {
    const res = await call({ cells: [{ jevChunkIndex: 1, chunkIndex: 3 }, { jevChunkIndex: 0, chunkIndex: 5 }] });
    expect(res.status).toBe(200);
    const { tokens } = await res.json();
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ jevChunkIndex: 1, chunkIndex: 3, tokenVersion: 2, streamCount: 9, jevChunkCount: 2, startWord: 10, endWord: 20 });
    expect(tokens[1]).toMatchObject({ jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sliceSha256: 'b'.repeat(64) });
  });
});
