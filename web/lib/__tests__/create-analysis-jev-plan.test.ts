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
const isAdminUser = vi.hoisted(() => vi.fn());

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
const defaultRegistry = (keys: string[], fallback: Record<string, unknown>) => {
  const result: Record<string, unknown> = { ...fallback };
  if (keys.includes('analysis.jev.enabled')) {
    result['analysis.jev.enabled'] = false;
  }
  if (keys.includes('analysis.jev.maxCostUsdCentsPerVideo')) {
    result['analysis.jev.maxCostUsdCentsPerVideo'] = 100;
  }
  return result;
};
vi.mocked(getRegistrySettings).mockImplementation(defaultRegistry);

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
    fetch: () => Promise.resolve({
      metadata: metadata(),
      transcript: TRANSCRIPT,
      transcriptAvailable: true,
    }),
    fetchOnlyMetadata: () => Promise.resolve(metadata()),
    detectPersona: () => 'general' as never,
    buildJobMetadata: () => metadata() as never,
  };
  const persistence = {
    findCachedAnalysis: () => Promise.resolve(null),
    upsertProcessingStub: () => Promise.resolve({ id: 'an-1', status: 'processing' }),
    persistJevPlan,
    findJevPlan: () => Promise.resolve(null),
    isAdminUser,
    persist: vi.fn(),
  };
  const billingQuota = {
    checkGate: () => Promise.resolve({ allowed: true, remaining: 10 }),
    consume: () => Promise.resolve({ ok: true }),
  };
  const modelResolution = {
    resolveModels: () => Promise.resolve(['m-1']),
  };
  const tokenCrypto = {
    signAnalysisToken: () => Promise.resolve('tok'),
  };
  const commentSampling = {
    planSample: () => Promise.resolve({ comments: [] }),
    estimateCreditCost: () => Promise.resolve({ credits: 0 }),
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

  it('resolves jevMaxParallelStreams from registry with fallback 6 and clamps to [1, 32]', async () => {
    const uc = buildUseCase();
    const result = await uc.execute(baseParams());
    expect(result.type).toBe('processing');
    expect(result.type === 'processing' && result.data.jevMaxParallelStreams).toBe(6);

    // Clamping test: override registry for analysis.jev.maxParallelStreams
    vi.mocked(getRegistrySettings).mockImplementation((keys: string[], fallback: Record<string, unknown>) => {
      const res: Record<string, unknown> = { ...fallback };
      if (keys.includes('analysis.jev.enabled')) {
        res['analysis.jev.enabled'] = false;
      }
      if (keys.includes('analysis.jev.maxCostUsdCentsPerVideo')) {
        res['analysis.jev.maxCostUsdCentsPerVideo'] = 100;
      }
      if (keys.includes('analysis.jev.maxParallelStreams')) {
        res['analysis.jev.maxParallelStreams'] = 64; // exceeds max 32
      }
      return res;
    });
    const resultClamped = await uc.execute(baseParams());
    expect(resultClamped.type).toBe('processing');
    expect(resultClamped.type === 'processing' && resultClamped.data.jevMaxParallelStreams).toBe(32);
    vi.mocked(getRegistrySettings).mockImplementation(defaultRegistry);
  });
});

describe('admin gate (R3b): K>1 planning needs the flag AND an admin requester', () => {
  const enabledRegistry = (keys: string[], fallback: Record<string, unknown>) => {
    const result = defaultRegistry(keys, fallback);
    if (keys.includes('analysis.jev.enabled')) result['analysis.jev.enabled'] = true;
    return result;
  };

  it('NEGATIVE CONTROL: a standard user gets the disabled (K=1) config even with analysis.jev.enabled on', async () => {
    vi.mocked(getRegistrySettings).mockImplementation(enabledRegistry);
    isAdminUser.mockResolvedValue(false);
    await buildUseCase().execute(baseParams());
    expect(isAdminUser).toHaveBeenCalledWith({ userId: 'u-1' });
    expect(planAnalysis.mock.calls[0][0].jevConfig.enabled).toBe(false);
    vi.mocked(getRegistrySettings).mockImplementation(defaultRegistry);
  });

  it('an admin gets the enabled config', async () => {
    vi.mocked(getRegistrySettings).mockImplementation(enabledRegistry);
    isAdminUser.mockResolvedValue(true);
    await buildUseCase().execute(baseParams());
    expect(planAnalysis.mock.calls[0][0].jevConfig.enabled).toBe(true);
    vi.mocked(getRegistrySettings).mockImplementation(defaultRegistry);
  });

  it('flag off: no role lookup at all', async () => {
    await buildUseCase().execute(baseParams());
    expect(isAdminUser).not.toHaveBeenCalled();
    expect(planAnalysis.mock.calls[0][0].jevConfig.enabled).toBe(false);
  });
});

describe('CreateAnalysisUseCase Phase C shadow grant (analysis.pipeline.epistemic)', () => {
  it('omits the grant when the flag is off (default)', async () => {
    const result = await buildUseCase().execute(baseParams());
    expect(result.type).toBe('processing');
    expect(result.type === 'processing' && 'epistemicShadow' in result.data).toBe(false);
  });

  it('signs a grant for this analysis when the flag is on, verifiable by the worker', async () => {
    const prev = process.env.STREAM_HMAC_SECRET;
    process.env.STREAM_HMAC_SECRET = 'shadow-test-secret';
    vi.mocked(getRegistrySettings).mockImplementation((keys: string[], fallback: Record<string, unknown>) => {
      const res = defaultRegistry(keys, fallback);
      if (keys.includes('analysis.pipeline.epistemic')) res['analysis.pipeline.epistemic'] = true;
      return res;
    });
    try {
      const result = await buildUseCase().execute(baseParams());
      expect(result.type).toBe('processing');
      const grant = result.type === 'processing' ? (result.data as { epistemicShadow?: { sig: string; exp: number } }).epistemicShadow : undefined;
      expect(grant?.sig).toMatch(/^[0-9a-f]{64}$/);
      const { verifyEpistemicShadowSig } = await import('@/lib/config/epistemic-shadow');
      const { env } = await import('@/lib/env');
      expect(await verifyEpistemicShadowSig({ secret: env.streamHmacSecret, analysisId: 'an-1', sig: grant?.sig, exp: grant?.exp })).toBe(true);
      expect(await verifyEpistemicShadowSig({ secret: env.streamHmacSecret, analysisId: 'another', sig: grant?.sig, exp: grant?.exp })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev;
      vi.mocked(getRegistrySettings).mockImplementation(defaultRegistry);
    }
  });
});
