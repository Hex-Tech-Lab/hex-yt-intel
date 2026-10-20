/**
 * Authorization + idempotence regression tests for POST /api/analyses/[id]/plan
 * (R3b 2.3, Option P1).
 *
 * Authorization: the plan endpoint MUST reject any request whose content
 * signature fails verification — before any database read or write happens.
 * A removed or reordered verifyContentSig call would hand an unauthenticated
 * caller the ability to write arbitrary plan topology into analyses.jev_plan.
 *
 * Idempotence: a stored plan is authoritative — the second call returns the
 * STORED plan and never re-computes (planAnalysis) or re-chunks.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyContentSig = vi.hoisted(() => vi.fn());
const planAnalysis = vi.hoisted(() => vi.fn());
const getRegistrySettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => serviceMock }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings },
}));
vi.mock('@/lib/usecases/PlanAnalysisUseCase', () => ({ planAnalysis }));
vi.mock('@/lib/config/cascade', () => ({
  resolveAnalysisCascade: () => Promise.resolve([{ model: 'x', name: 'x', cost: 0.003 }]),
}));

import { POST } from '@/app/api/analyses/[id]/plan/route';

function makeService() {
  const state = { writes: 0, reads: 0 };
  let storedPlanValue: unknown = null;
  const builder = () => {
    const builderChain: Record<string, unknown> = {};
    builderChain.select = () => builderChain;
    builderChain.eq = () => builderChain;
    builderChain.is = () => builderChain;
    builderChain.update = (patch: { jev_plan?: unknown }) => {
      state.writes += 1;
      // Simulate the conditional update landing: the row now holds the plan.
      if (patch && 'jev_plan' in patch) storedPlanValue = patch.jev_plan;
      return builderChain;
    };
    builderChain.maybeSingle = () => {
      state.reads += 1;
      return Promise.resolve({ data: { jev_plan: storedPlanValue ?? null }, error: null });
    };
    return builderChain;
  };
  const service = {
    __state: state,
    __setStoredPlan: (storedValue: unknown) => {
      storedPlanValue = storedValue;
    },
    from(_table: string) {
      return builder();
    },
  };
  return service;
}

const serviceMock = makeService();

function body() {
  return {
    videoId: 'vid123',
    transcript: 'short transcript text here',
    sig: 'forged',
    exp: Date.now() + 60_000,
  };
}

function post(requestBody: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/analyses/an-1/plan', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }),
    { params: Promise.resolve({ id: 'an-1' }) } as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock.__setStoredPlan(null);
  serviceMock.__state.writes = 0;
  serviceMock.__state.reads = 0;
  verifyContentSig.mockResolvedValue(false);
  getRegistrySettings.mockResolvedValue({});
  planAnalysis.mockResolvedValue({
    K: 1,
    streamCount: 5,
    cells: [],
    estimateCents: 27,
    truncatedFallback: false,
  });
});

describe('POST /api/analyses/[id]/plan — authorization', () => {
  it('401 with ZERO db reads/writes when the signature fails', async () => {
    const res = await post(body());
    expect(res.status).toBe(401);
    expect(serviceMock.__state.reads).toBe(0);
    expect(serviceMock.__state.writes).toBe(0);
    expect(planAnalysis).not.toHaveBeenCalled();
  });

  it('400 on a malformed body before any signature check', async () => {
    const res = await post({ videoId: 'vid123' });
    expect(res.status).toBe(400);
    expect(serviceMock.__state.reads).toBe(0);
    expect(serviceMock.__state.writes).toBe(0);
  });
});

describe('POST /api/analyses/[id]/plan — idempotence', () => {
  it('returns the STORED plan without re-computing when one exists', async () => {
    verifyContentSig.mockResolvedValue(true);
    const stored = { K: 3, streamCount: 13, cells: [{ jevChunkIndex: 1 }], estimateCents: 90, truncatedFallback: false };
    serviceMock.__setStoredPlan(stored);

    const res = await post(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(true);
    expect(json.plan).toEqual(stored);
    expect(planAnalysis).not.toHaveBeenCalled();
    expect(serviceMock.__state.writes).toBe(0);
  });

  it('computes and persists once when no plan is stored', async () => {
    verifyContentSig.mockResolvedValue(true);
    serviceMock.__setStoredPlan(undefined);

    const res = await post(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(planAnalysis).toHaveBeenCalledTimes(1);
    expect(serviceMock.__state.writes).toBe(1);
    expect(json.plan.K).toBe(1);
    expect(json.plan.streamCount).toBe(5);
  });

  it('K=1 when analysis.jev.enabled is false/absent (registry defaults)', async () => {
    verifyContentSig.mockResolvedValue(true);
    serviceMock.__setStoredPlan(undefined);
    getRegistrySettings.mockResolvedValue({});

    const res = await post(body());
    const json = await res.json();
    expect(json.plan.K).toBe(1);
    expect(json.plan.streamCount).toBe(5);
  });

  it('admin gate: with analysis.jev.enabled on, a non-admin owner is planned with Jev disabled (K=1)', async () => {
    verifyContentSig.mockResolvedValue(true);
    serviceMock.__setStoredPlan(undefined);
    getRegistrySettings.mockResolvedValue({ 'analysis.jev.enabled': true });

    await post(body());
    // The service mock has no admin owner row (no user_id), so the gate
    // fails closed and the planner gets enabled=false.
    expect(planAnalysis.mock.calls.at(-1)?.[0].jevConfig.enabled).toBe(false);
  });
});
