/**
 * Dimension Remediation — failed-attempt retry burn + counter-persistence
 * contract (PR #310 post-merge review: P1b enforced counter persistence,
 * P1c record_remediation_failure RPC contract, P2c worker-failure-path
 * coverage, P1b harness quarantine gate). Split from
 * dimension-remediation.test.ts (qa-intel 500-line file gate);
 * candidate-SELECTION tests (transcript gate, eligibility pagination) live
 * in that sibling file. markdownWithDimensions / fakeServiceClient are
 * deliberately duplicated per-file — same self-contained-test precedent as
 * analysis-reaper.test.ts and analysis-requeue.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  persistRemediationFailureCounter,
  type AnalysisGap,
} from '@/lib/services/dimension-remediation';

const markdownWithDimensions = (numbers: number[]): string =>
  numbers
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
describe('persistRemediationFailureCounter (P1b — enforced counter persistence)', () => {
  it('reports recorded on a winning write, without quarantining', async () => {
    const quarantine = vi.fn(() => Promise.resolve());
    const outcome = await persistRemediationFailureCounter({
      analysisId: 'a-1',
      attempt: vi.fn().mockResolvedValue({ updated: true }),
      quarantine,
      delaysMs: [10, 10],
    });
    expect(outcome).toBe('recorded');
    expect(quarantine).not.toHaveBeenCalled();
  });

  it('reports cas_lost on {updated:false} — another writer owns the row, no quarantine', async () => {
    const attempt = vi.fn().mockResolvedValue({ updated: false });
    const quarantine = vi.fn(() => Promise.resolve());
    const outcome = await persistRemediationFailureCounter({
      analysisId: 'a-1',
      attempt,
      quarantine,
      delaysMs: [10, 10],
    });
    expect(outcome).toBe('cas_lost');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(quarantine).not.toHaveBeenCalled();
  });

  it('retries after a transient write error and records once it succeeds', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ updated: true });
    const quarantine = vi.fn(() => Promise.resolve());
    const outcome = await persistRemediationFailureCounter({
      analysisId: 'a-1',
      attempt,
      quarantine,
      delaysMs: [10, 10],
    });
    expect(outcome).toBe('recorded');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(quarantine).not.toHaveBeenCalled();
  });

  it('quarantines after every retry fails — the row stops being selectable even though the counter never incremented', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('supabase write failing'));
    const quarantine = vi.fn(() => Promise.resolve());
    const outcome = await persistRemediationFailureCounter({
      analysisId: 'a-1',
      attempt,
      quarantine,
      delaysMs: [10, 10],
    });
    // 1 initial attempt + one per retry delay, then quarantine.
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(outcome).toBe('quarantined');
    expect(quarantine).toHaveBeenCalledWith('a-1');
  });

  it('survives a quarantine write that itself fails (money gate still bounds spend via the token bucket)', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('supabase write failing'));
    const quarantine = vi.fn().mockRejectedValue(new Error('redis also down'));
    const outcome = await persistRemediationFailureCounter({
      analysisId: 'a-1',
      attempt,
      quarantine,
      delaysMs: [10, 10],
    });
    expect(outcome).toBe('quarantined');
  });
});

describe('SupabasePersistenceAdapter.recordRemediationFailure — RPC contract (P1c)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/supabase');
    vi.restoreAllMocks();
  });

  const loadAdapter = async (rpcImpl: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) => {
    const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
    const client = {
      from: () => {
        throw new Error('recordRemediationFailure must go through the record_remediation_failure RPC, not a table .update()');
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        rpcCalls.push({ fn, params });
        return rpcImpl(fn, params);
      },
    };
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));
    const mod = await import('@/lib/adapters/SupabasePersistenceAdapter');
    return { adapter: new mod.SupabasePersistenceAdapter(), rpcCalls };
  };

  it('calls the record_remediation_failure RPC with the exact expected-retry-count CAS params (first failure: counter absent-or-0)', async () => {
    const { adapter, rpcCalls } = await loadAdapter(() => Promise.resolve({ data: true, error: null }));
    const outcome = await adapter.recordRemediationFailure({
      analysisId: 'a-1',
      previousRetryCount: 0,
      failedStage: 'worker_failed',
      failedAt: '2026-09-11T12:00:00.000Z',
      guardBillingStatus: 'failed',
    });
    expect(outcome).toEqual({ updated: true });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe('record_remediation_failure');
    expect(rpcCalls[0]?.params).toEqual({
      p_analysis_id: 'a-1',
      p_guard_billing_status: 'failed',
      p_expected_retry_count: 0,
      p_failure_stage: 'worker_failed',
      p_failed_at: '2026-09-11T12:00:00.000Z',
    });
  });

  it('passes the previous retry count as the CAS expectation on subsequent failures', async () => {
    const { adapter, rpcCalls } = await loadAdapter(() => Promise.resolve({ data: true, error: null }));
    await adapter.recordRemediationFailure({
      analysisId: 'a-1',
      previousRetryCount: 2,
      failedStage: 'stitch_failed',
      failedAt: '2026-09-11T12:05:00.000Z',
      guardBillingStatus: 'failed',
    });
    expect(rpcCalls[0]?.params.p_expected_retry_count).toBe(2);
    expect(rpcCalls[0]?.params.p_failure_stage).toBe('stitch_failed');
  });

  it('maps an RPC false (guard mismatch / CAS loss) to { updated: false }', async () => {
    const { adapter } = await loadAdapter(() => Promise.resolve({ data: false, error: null }));
    const outcome = await adapter.recordRemediationFailure({
      analysisId: 'a-1',
      previousRetryCount: 1,
      failedStage: 'worker_failed',
      failedAt: '2026-09-11T12:10:00.000Z',
      guardBillingStatus: 'failed',
    });
    expect(outcome).toEqual({ updated: false });
  });

  it('throws on a genuine RPC error (fail closed — the caller retries then quarantines)', async () => {
    const { adapter } = await loadAdapter(() => Promise.resolve({ data: null, error: new Error('db connection refused') }));
    await expect(
      adapter.recordRemediationFailure({
        analysisId: 'a-1',
        previousRetryCount: 1,
        failedStage: 'worker_failed',
        failedAt: '2026-09-11T12:15:00.000Z',
        guardBillingStatus: 'failed',
      })
    ).rejects.toThrow('db connection refused');
  });
});
describe('remediateAnalysis — failed-attempt retry burn (integration, mocked worker+redis)', () => {
  const gap: AnalysisGap = {
    id: 'gap-1',
    userId: 'u-1',
    videoId: 'VID',
    title: 't',
    channelTitle: 'c',
    metadata: { persona: 'creator' },
    analysisMarkdown: markdownWithDimensions([1, 2]),
    analysisPayload: null,
    validationReport: { status: 'partial', remediation_retry_count: 0 },
    missingDimensions: [3],
  };

  function loadWithMocks(
    opts: {
      recordRemediationFailure?: ReturnType<typeof vi.fn>;
      stitchResult?: { payload: unknown; markdown: string; validationPassed: boolean };
      setRedisValue?: ReturnType<typeof vi.fn>;
    } = {}
  ) {
    const recordRemediationFailure = opts.recordRemediationFailure ?? vi.fn().mockResolvedValue({ updated: true });
    const setRedisValue = opts.setRedisValue ?? vi.fn(() => Promise.resolve());
    vi.doMock('@/lib/redis', () => ({
      tryConsumeTokenBucket: vi.fn().mockResolvedValue(true),
      incrementRedisValue: vi.fn().mockResolvedValue(1),
      getRedisValue: vi.fn().mockResolvedValue(null),
      setRedisValue,
    }));
    vi.doMock('@/lib/stream-token', () => ({
      signStreamToken: vi.fn().mockResolvedValue({ sig: 'test-sig', exp: 9999999999 }),
    }));
    vi.doMock('@/lib/env', () => ({
      env: { cloudflareWorkerUrl: 'http://worker.test' },
    }));
    vi.doMock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
      SupabaseSettingsAdapter: {
        getRegistrySettings: vi.fn().mockResolvedValue({
          'analysis.llmCascade.timeoutMs': 240000,
          'analysis.llmCascade.handshakeTimeoutMs': 15000,
          'analysis.remediation.connectionTimeoutMs': 3000,
        }),
      },
    }));
    if (opts.stitchResult !== undefined) {
      vi.doMock('@/lib/services/stitch-analysis-chunks', () => ({
        stitchChunksIntoPayload: vi.fn().mockReturnValue(opts.stitchResult),
        buildDimensionStatus: vi.fn().mockReturnValue({ dimensionStatus: [], validationStatus: 'partial', billingStatus: 'failed' }),
      }));
    }
    vi.doMock('@/lib/adapters/SupabaseBillingAdapter', () => ({
      SupabaseBillingAdapter: { logUsageEvent: vi.fn(() => Promise.resolve()) },
    }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        recordRemediationFailure = recordRemediationFailure;
        updateAnalysisResult = vi.fn().mockResolvedValue({ updated: true });
      },
    }));
    return { recordRemediationFailure, setRedisValue };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/redis');
    vi.doUnmock('@/lib/stream-token');
    vi.doUnmock('@/lib/env');
    vi.doUnmock('@/lib/adapters/SupabaseSettingsAdapter');
    vi.doUnmock('@/lib/services/stitch-analysis-chunks');
    vi.doUnmock('@/lib/adapters/SupabaseBillingAdapter');
    vi.doUnmock('@/lib/adapters');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const budget = { capacityCents: 200, costPer1K: 0.0008, quarantineTtlSeconds: 3600 };

  it('worker returning non-2xx records the failure and burns one retry (was unbounded before 2026-09-11)', async () => {
    const { recordRemediationFailure } = loadWithMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('worker exploded') })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(recordRemediationFailure).toHaveBeenCalledTimes(1);
    const call = recordRemediationFailure.mock.calls[0]?.[0] as {
      analysisId: string;
      previousRetryCount: number;
      failedStage: string;
      failedAt: string;
      guardBillingStatus: string;
    };
    expect(call.analysisId).toBe('gap-1');
    expect(call.previousRetryCount).toBe(0);
    expect(call.guardBillingStatus).toBe('failed');
    expect(call.failedStage).toBe('worker_failed');
    expect(call.failedAt).toBeTruthy();
  });

  it('P1b: CAS loss ({updated:false}) is NOT quarantined — another writer owns the row', async () => {
    const recordRemediationFailure = vi.fn().mockResolvedValue({ updated: false });
    const { setRedisValue } = loadWithMocks({ recordRemediationFailure });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('worker exploded') })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(setRedisValue).not.toHaveBeenCalled();
  });

  it('P1b: a persistently failing counter write quarantines the row (stops unbounded retries without the counter)', async () => {
    const recordRemediationFailure = vi.fn().mockRejectedValue(new Error('db write failing'));
    const { setRedisValue } = loadWithMocks({ recordRemediationFailure });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('worker exploded') })
    );
    vi.useFakeTimers();

    const mod = await import('@/lib/services/dimension-remediation');
    const pending = mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    await vi.advanceTimersByTimeAsync(1_000); // retry 1
    await vi.advanceTimersByTimeAsync(2_000); // retry 2 → quarantine
    const result = await pending;

    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(recordRemediationFailure).toHaveBeenCalledTimes(3);
    expect(setRedisValue).toHaveBeenCalledWith(
      'remediation:quarantine:gap-1',
      expect.any(String),
      3600
    );
  });

  it('P2c: a fetch() that REJECTS (network error, not just non-2xx) records the failure and burns one retry', async () => {
    const { recordRemediationFailure } = loadWithMocks();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed: network down')));

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(recordRemediationFailure).toHaveBeenCalledTimes(1);
    expect((recordRemediationFailure.mock.calls[0]?.[0] as { failedStage: string }).failedStage).toBe('worker_failed');
  });

  it('P2c: an empty/entirely-unparseable worker stream records the failure (no usable fragments → WorkerFailed)', async () => {
    const { recordRemediationFailure } = loadWithMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: not-json-at-all\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        }),
      })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(recordRemediationFailure).toHaveBeenCalledTimes(1);
  });

  it('P2c: the StitchFailed path burns the counter with stage stitch_failed', async () => {
    const { recordRemediationFailure } = loadWithMocks({
      stitchResult: { payload: null, markdown: '', validationPassed: false },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"dimension","dimension":3,"name":"D3","content":"Some content."}\n\n'));
            controller.close();
          },
        }),
      })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    expect(result.stage).toBe(mod.RemediationStage.StitchFailed);
    const call = recordRemediationFailure.mock.calls[0]?.[0] as { failedStage: string };
    expect(call.failedStage).toBe('stitch_failed');
  });

  it('a usable worker response proceeds to stitch/persist and must NOT burn the failure counter', async () => {
    const recordRemediationFailure = vi.fn().mockResolvedValue({ updated: true });
    loadWithMocks({ recordRemediationFailure });
    const sseBody = [
      'data: {"type":"dimension","dimension":3,"name":"D3","content":"Some content."}',
      '',
      '',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
      })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], budget);
    // gap has dims 1..2 present; dim 3 arrives → still partial (9 missing) but
    // the attempt itself SUCCEEDED — the failure counter must stay untouched
    // (StillPartial's own increment flows through updateAnalysisResult, as before).
    expect(result.stage).toBe(mod.RemediationStage.StillPartial);
    expect(recordRemediationFailure).not.toHaveBeenCalled();
  });
});
