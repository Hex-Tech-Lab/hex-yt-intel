/**
 * Route-level contract tests for GET /api/analyses/[id]/relations
 * (PR #322 round-2 review, P2: the prior kg-relations.contract.test.ts ADR
 * 031 assertions built in-memory objects and never exercised the route).
 *
 * Covers: Redis hit, Redis miss + Supabase hit, stale content hash,
 * non-empty persist, EMPTY-but-valid persist, Redis failure, Supabase
 * failure, compute failure, unrelated-key preservation (atomic merge
 * contract), and the authorization branch.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    getRedisValue: vi.fn<[], Promise<unknown>>(),
    setRedisValue: vi.fn<[], Promise<void>>(() => Promise.resolve()),
    deleteRedisKey: vi.fn<[], Promise<void>>(() => Promise.resolve()),
    getUser: vi.fn<[], Promise<{ data: { user: { id: string } | null } }>>(),
    mergePayloadKey: vi.fn<[], Promise<{ persisted: boolean; affectedRows: number }>>(),
    computeStream: vi.fn(),
  };
});

vi.mock('@/lib/redis', () => ({
  getRedisValue: mocks.getRedisValue,
  setRedisValue: mocks.setRedisValue,
  deleteRedisKey: mocks.deleteRedisKey,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => ({
              data: cols.includes('analysis_payload') ? mockState.payloadRow : mockState.markdownRow,
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/adapters/SupabaseAnalysisPayloadAdapter', () => {
  return {
    SupabaseAnalysisPayloadAdapter: class {
      mergePayloadKey = mocks.mergePayloadKey;
    },
  };
});

vi.mock('@/lib/intelligence/relations-engine', () => ({
  computeStanceRelationsStream: mocks.computeStream,
}));

import { GET } from '../route';

const mockState: { markdownRow: Record<string, unknown> | null; payloadRow: Record<string, unknown> | null } = {
  markdownRow: null,
  payloadRow: null,
};

const SAMPLE_MARKDOWN = '# DIMENSION 1 – Thesis\n\nContent one.\n\n# DIMENSION 2 – Risk\n\nContent two.';

async function sha16(text: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/^[0-9a-f]{16}/)?.[0] ?? hex;
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/analyses/a1/relations');
}

async function run(): Promise<Array<Record<string, unknown>>> {
  const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'a1' }) });
  const text = await res.text();
  return text
    .split('\n\n')
    .map((line) => line.replace(/^data: /, ''))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations from a prior test — reset so e.g.
  // the Redis-hit cached value can't leak into later tests.
  mocks.getRedisValue.mockReset();
  mocks.mergePayloadKey.mockReset();
  mocks.mergePayloadKey.mockResolvedValue({ persisted: true, affectedRows: 1 });
  mocks.setRedisValue.mockReset();
  mocks.setRedisValue.mockResolvedValue(undefined);
  mocks.deleteRedisKey.mockReset();
  mocks.deleteRedisKey.mockResolvedValue(undefined);
  mockState.markdownRow = null;
  mockState.payloadRow = null;
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/analyses/[id]/relations (route-level contract)', () => {
  it('401-style error event when unauthenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const events = await run();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: 'Unauthorized' });
  });

  it('Redis HIT: returns cached result and never touches the payload or the LLM', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    const cached = { analysisId: 'a1', generatedAt: 't', model: 'm', insights: [{ kind: 'tangent' }] };
    mocks.getRedisValue.mockResolvedValue(JSON.stringify(cached));

    const events = await run();

    expect(events.at(-1)).toMatchObject({ cached: true, type: 'complete', model: 'm' });
    expect(mocks.computeStream).not.toHaveBeenCalled();
    expect(mocks.mergePayloadKey).not.toHaveBeenCalled();
  });

  it('Redis MISS + Supabase HIT (contentHash matches): serves persisted relations, no LLM call', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    const hash = await sha16(SAMPLE_MARKDOWN);
    mockState.payloadRow = {
      analysis_payload: {
        unrelated_key: { keep: true },
        stance_relations: {
          analysisId: 'a1', generatedAt: 't', model: 'persisted-model',
          insights: [{ kind: 'contrarian', source: 1, target: 2 }],
          contentHash: hash,
        },
      },
    };

    const events = await run();

    expect(events.at(-1)).toMatchObject({ cached: true, type: 'complete', model: 'persisted-model' });
    expect(mocks.computeStream).not.toHaveBeenCalled();
    // contentHash is stripped from the served result (internal marker only)
    expect(events.at(-1)).not.toHaveProperty('contentHash');
  });

  it('STALE contentHash: falls through to LLM compute and persists fresh result', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = {
      analysis_payload: {
        stance_relations: { analysisId: 'a1', generatedAt: 't', model: 'old', insights: [], contentHash: 'stale-hash' },
      },
    };
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
      yield { type: 'insight', insight: { kind: 'tangent', source: 1, target: 2, sourceLabel: 'A', targetLabel: 'B', rationale: 'r' } };
    });

    const events = await run();
    const freshHash = await sha16(SAMPLE_MARKDOWN);

    expect(mocks.computeStream).toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'complete', model: 'model/new' });
    expect(events.some((e) => e.type === 'insight')).toBe(true);
    expect(mocks.mergePayloadKey).toHaveBeenCalledWith('a1', 'stance_relations', expect.objectContaining({ contentHash: freshHash }));
  });

  it('NON-EMPTY persist: merge receives ONLY (id, key, value) — no full-payload read-modify-write', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = { analysis_payload: null };
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
      yield { type: 'insight', insight: { kind: 'tangent', source: 1, target: 2, sourceLabel: 'A', targetLabel: 'B', rationale: 'r' } };
    });

    await run();

    expect(mocks.mergePayloadKey).toHaveBeenCalledTimes(1);
    const args = mocks.mergePayloadKey.mock.calls[0] as unknown[];
    // Exactly (analysisId, key, value) — the atomic RPC contract. The old
    // implementation passed the whole merged payload object to a full-row
    // update (lost-update race); this shape regression-guards the fix.
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('a1');
    expect(args[1]).toBe('stance_relations');
    expect(args[2]).toMatchObject({ analysisId: 'a1', insights: [expect.anything()] });
    expect(args[2]).not.toHaveProperty('unrelated_key');
    expect(mocks.setRedisValue).toHaveBeenCalled();
  });

  it('EMPTY-but-VALID persist: zero insights from a completed cascade IS persisted', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = null;
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
      // stream ends cleanly with zero insights — a valid result
    });

    const events = await run();
    const freshHash = await sha16(SAMPLE_MARKDOWN);

    expect(events.at(-1)).toMatchObject({ type: 'complete' });
    expect(mocks.mergePayloadKey).toHaveBeenCalledWith('a1', 'stance_relations',
      expect.objectContaining({ insights: [], contentHash: freshHash }));
    expect(mocks.setRedisValue).toHaveBeenCalled();
  });

  it('Redis FAILURE: complete result still delivered, Supabase persistence still attempted', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = null;
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.setRedisValue.mockRejectedValue(new Error('redis down'));
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
      yield { type: 'insight', insight: { kind: 'tangent', source: 1, target: 2, sourceLabel: 'A', targetLabel: 'B', rationale: 'r' } };
    });

    const events = await run();

    expect(events.at(-1)).toMatchObject({ type: 'complete', model: 'model/new' });
    expect(mocks.mergePayloadKey).toHaveBeenCalled();
  });

  it('Supabase FAILURE (0 rows / failed after retries): request still succeeds, error is not silent (warned)', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = null;
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.mergePayloadKey.mockResolvedValue({ persisted: false, affectedRows: 0 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
      yield { type: 'insight', insight: { kind: 'tangent', source: 1, target: 2, sourceLabel: 'A', targetLabel: 'B', rationale: 'r' } };
    });

    const events = await run();

    expect(events.at(-1)).toMatchObject({ type: 'complete' });
    expect(warnSpy).toHaveBeenCalledWith(
      '[relations/route] stance_relations persistence did not land (0 rows affected or failed after retries)',
      expect.objectContaining({ id: 'a1' })
    );
    warnSpy.mockRestore();
  });

  it('Compute FAILURE: fallback empty result delivered, NOTHING persisted (failures are never cached)', async () => {
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = null;
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.computeStream.mockRejectedValue(new Error('all models exhausted'));

    const events = await run();

    expect(events.at(-1)).toMatchObject({ type: 'complete', insights: [] });
    expect(mocks.mergePayloadKey).not.toHaveBeenCalled();
    expect(mocks.setRedisValue).not.toHaveBeenCalled();
  });

  it('unrelated_key survives conceptually: route never writes a merged payload object', async () => {
    // Strengthening the atomicity contract: the route must not attempt any
    // whole-row analysis_payload update. The mocked adapter records exactly
    // what would go to the RPC; assert the value is ONLY the relations blob.
    mockState.markdownRow = { id: 'a1', analysis_markdown: SAMPLE_MARKDOWN };
    mockState.payloadRow = { analysis_payload: { unrelated_key: { keep: true } } };
    mocks.getRedisValue.mockResolvedValue(null);
    mocks.computeStream.mockImplementation(function* () {
      yield { type: 'model', model: 'model/new' };
    });

    await run();

    const value = (mocks.mergePayloadKey.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(['analysisId', 'contentHash', 'generatedAt', 'insights', 'model']);
  });
});
