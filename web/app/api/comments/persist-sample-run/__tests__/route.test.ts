/**
 * Authorization regression test (colocated with the route, per qa-intel
 * policy): the persist-sample-run endpoint MUST reject any request whose
 * content signature fails verification — before any database read or write
 * happens. A removed or reordered verifyContentSig call reintroduces an
 * unauthenticated write path into comment_sample_runs /
 * comment_classifications / analyses.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyContentSig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => serviceMock }));
vi.mock('@/lib/adapters/SupabaseCommentSamplingAdapter', () => ({
  SupabaseCommentSamplingAdapter: class {
    async estimateCreditCost() {
      return { estimatedCredits: 10, estimateParamsVersion: 'v1' };
    }
  },
}));

import { POST } from '@/app/api/comments/persist-sample-run/route';

function makeService() {
  const state = {
    runs: [] as Array<Record<string, unknown>>,
    runsQueried: 0,
    writes: 0,
  };
  const service = {
    __state: state,
    from(_table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => {
        const b2: Record<string, unknown> = {};
        b2.eq = () => {
          state.runsQueried += 1;
          return b2;
        };
        b2.maybeSingle = () =>
          Promise.resolve({ data: state.runsQueried > 0 ? { id: 'run' } : null, error: null });
        b2.single = () => Promise.resolve({ data: null, error: null });
        return b2;
      };
      builder.insert = () => {
        state.writes += 1;
        return { select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) };
      };
      builder.upsert = () => {
        state.writes += 1;
        return { select: () => Promise.resolve({ data: [], error: null }) };
      };
      builder.update = () => {
        const b2: Record<string, unknown> = {};
        b2.eq = () => {
          state.writes += 1;
          const settled = Promise.resolve({ data: null, error: null });
          return Object.assign(settled, { in: () => settled });
        };
        return b2;
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return service;
}

const serviceMock = makeService();

function body() {
  return {
    sampleRunId: '5f0c2b3a-0000-4000-8000-000000000001',
    userId: '5f0c2b3a-0000-4000-8000-000000000002',
    sampledCount: 1,
    status: 'completed',
    mode: 'cochran',
    cochran: {
      mode: 'cochran',
      sampledCount: 1,
      population: 10,
      insights: {
        population: 10,
        reportedTotal: 10,
        sampleSize: 1,
        classified: 1,
        failed: 0,
        lowConfidence: 0,
        marginOfError: 0.2,
        confidence: 0.95,
        marginScope: 'sampled_pool',
        sentiment: { positive: 1, negative: 0, neutral: 0, mixed: 0 },
        types: { experience: 1 },
        painPointCount: 0,
        questionCount: 0,
        costUsd: 0,
        model: 'jev',
        completedAt: '2026-09-30T00:00:00.000Z',
      },
      classifications: [],
      sampledComments: [],
    },
    sig: 'forged',
    exp: Date.now() + 60_000,
  };
}

function post(requestBody: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/comments/persist-sample-run', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
  );
}

describe('POST /api/comments/persist-sample-run — authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.__state.runsQueried = 0;
    serviceMock.__state.writes = 0;
    verifyContentSig.mockResolvedValue(true);
  });

  it('NEGATIVE CONTROL: invalid signature -> 401 with ZERO database reads or writes', async () => {
    verifyContentSig.mockResolvedValue(false);
    const res = await post(body());
    expect(res.status).toBe(401);
    // The signature gate must short-circuit: no run lookup, no writes.
    expect(serviceMock.__state.runsQueried).toBe(0);
    expect(serviceMock.__state.writes).toBe(0);
  });

  it('valid signature passes the gate (control)', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(verifyContentSig).toHaveBeenCalled();
  });
});
