/**
 * R3b 2.3 (Option P1) regression: CreateAnalysisUseCase inline planning.
 *
 * - `analysis.jev.enabled` false/absent ⇒ planAnalysis receives the resolved
 *   JEV_DEFAULTS config and the job response carries `jevPlan` with K = 1 —
 *   behaviour identical to pre-Jev today.
 * - Plan is persisted exactly once via persistJevPlan.
 * - Planning failure NEVER blocks analysis creation (K = 1 fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const planAnalysis = vi.hoisted(() => vi.fn());
const getRegistrySettings = vi.hoisted(() => vi.fn());
const persistJevPlan = vi.hoisted(() => vi.fn());

vi.mock('@/lib/usecases/PlanAnalysisUseCase', () => ({ planAnalysis }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { CreateAnalysisUseCase } from '@/lib/usecases/CreateAnalysisUseCase';
import { JEV_DEFAULTS, resolveJevConfig } from '@/lib/config/jev';

// Registry returns jev defaults verbatim with `enabled: false` (the absent/
// disabled case). All other registry reads fall back to the same numbers the
// use case itself uses.
vi.mocked(getRegistrySettings).mockImplementation(async (keys: string[], fallback: Record<string, unknown>) => {
  void keys;
  return {
    ...fallback,
    'analysis.jev.enabled': false,
    'analysis.jev.maxCostUsdCentsPerVideo': 100,
  };
});

const TRANSCRIPT = 'hello world '.repeat(50);

function metadata() {
  return {
    title: 'T',
    channelTitle: 'C',
    viewCount: 1,
    publishedAt: '2026-01-01',
  };
}

function buildUseCase() {
  const metadataIngestion = {
    fetch: async () => ({
      metadata: metadata(),
      transcript: TRANSCRIPT,
      transcriptAvailable: true,
    }),
    fetchOnlyMetadata: async () => metadata(),
    detectPersona: () => 'general' as never,
    buildJobMetadata: () => metadata() as never,
  };
  const persistence = {
    findCachedAnalysis: async () => null,
    upsertProcessingStub: async () => ({ id: 'an-1', status: 'processing' }),
    persistJevPlan,
    findJevPlan: async () => null,
    persist: vi.fn(),
  };
  const billingQuota = {
    checkGate: async () => ({ allowed: true, remaining: 10 }),
    consume: async () => ({ ok: true }),
  };
  const modelResolution = {
    resolveModels: async () => ['m-1'],
  };
  const tokenCrypto = {
    signAnalysisToken: async () => 'tok',
  };
  const commentSampling = {
    planSample: async () => ({ comments: [] }),
    estimateCreditCost: async () => ({ credits: 0 }),
  };
  return new CreateAnalysisUseCase(
    metadataIngestion as never,
    persistence as never,
    billingQuota as never,
    modelResolution as never,
    tokenCrypto as never,
    commentSampling as never
  );
}

function baseParams() {
  return {
    url: 'https://youtube.com/watch?v=vid-1',
    userId: 'u-1',
    tier: 'free' as const,
    timezone: 'UTC',
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  planAnalysis.mockResolvedValue({
    K: 1,
    streamCount: 5,
    cells: [],
    estimateCents: 27,
    truncatedFallback: false,
  });
  persistJevPlan.mockResolvedValue({ plan: { K: 1 }, stored: true });
});

describe('CreateAnalysisUseCase inline Jev planning (P1)', () => {
  it('plans inline when transcript is available and persists the plan once', async () => {
    const uc = buildUseCase();
    const result = await uc.execute(baseParams());
    expect(result.type).not.toBe('error');
    expect(planAnalysis).toHaveBeenCalledTimes(1);
    expect(persistJevPlan).toHaveBeenCalledTimes(1);
    expect(persistJevPlan.mock.calls[0][0].analysisId).toBe('an-1');
    expect((result as { data?: { jevPlan?: unknown } }).data?.jevPlan).toBeTruthy();
  });

  it('K=1 when analysis.jev.enabled is false (registry default path)', async () => {
    const uc = buildUseCase();
    await uc.execute(baseParams());
    const arg = planAnalysis.mock.calls[0][0];
    // The config passed to planAnalysis must be the disabled-defaults one:
    // resolveJevConfig({}) with enabled=false yields the frozen defaults.
    expect(arg.jevConfig).toEqual(resolveJevConfig({ ...JEV_DEFAULTS, enabled: false }));
    expect(arg.transcript).toBe(TRANSCRIPT);
  });

  it('does NOT block analysis creation when planAnalysis throws', async () => {
    planAnalysis.mockRejectedValueOnce(new Error('boom'));
    const uc = buildUseCase();
    const result = await uc.execute(baseParams());
    expect(result.type).not.toBe('error');
    expect(persistJevPlan).not.toHaveBeenCalled();
  });
});
