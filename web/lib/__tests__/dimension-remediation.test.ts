/**
 * Dimension Remediation — missing-dimension detection + the 2026-09-11
 * budget-drain guards (transcript-presence candidacy gate, failed-attempt
 * retry-counter burn).
 *
 * Pure logic (computeMissingDimensions, buildRemediationFailurePatch,
 * filterGapsWithTranscript) is tested directly; the DB/worker-calling paths
 * (findAnalysesWithMissingDimensions, remediateAnalysis) are covered with
 * mocked Supabase/fetch clients following the analysis-requeue.test.ts
 * pattern — the 2026-09-01 live incident (entire monthly $2.00 hardCap
 * burned in 35 minutes on 12 transcript-purged rows, 88 usage_log events,
 * every tick since silently BudgetExhausted) is the negative control these
 * guards exist to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeMissingDimensions,
  buildRemediationFailurePatch,
  filterGapsWithTranscript,
  type AnalysisGap,
} from '@/lib/services/dimension-remediation';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/** Build markdown containing UCIS dimension headers for exactly the given numbers. */
function markdownWithDimensions(numbers: number[]): string {
  return numbers
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
}

describe('computeMissingDimensions', () => {
  it('returns all dimensions missing for empty markdown', () => {
    expect(computeMissingDimensions('')).toEqual(
      Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1)
    );
  });

  it('returns nothing missing for a complete analysis', () => {
    const all = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1);
    expect(computeMissingDimensions(markdownWithDimensions(all))).toEqual([]);
  });

  it('detects a single missing dimension in the middle', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => n !== 5);
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([5]);
  });

  it('detects multiple non-contiguous missing dimensions', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => ![2, 7, 11].includes(n));
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([2, 7, 11]);
  });

  it('detects a trailing gap (dimensions present 1..8 only, the exact LLMCascade-crash shape)', () => {
    const present = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([9, 10, 11]);
  });
});

describe('buildRemediationFailurePatch (2026-09-11 budget-drain guard)', () => {
  const nowIso = '2026-09-11T12:00:00.000Z';

  it('bumps the shared remediation_retry_count ceiling and records the failure stage', () => {
    const { validationReport, nextRetryCount } = buildRemediationFailurePatch(
      { persona: 'creator', status: 'partial', remediation_retry_count: 1 },
      1,
      'worker_failed',
      nowIso
    );
    expect(nextRetryCount).toBe(2);
    expect(validationReport).toMatchObject({
      persona: 'creator',
      status: 'partial',
      remediation_retry_count: 2,
      remediation_last_failure_at: nowIso,
      remediation_last_failure_stage: 'worker_failed',
    });
  });

  it('tolerates a null/array prior report and starts the counter at 1', () => {
    const fromNull = buildRemediationFailurePatch(null, 0, 'stitch_failed', nowIso);
    expect(fromNull.nextRetryCount).toBe(1);
    expect(fromNull.validationReport.remediation_retry_count).toBe(1);
    const fromArray = buildRemediationFailurePatch(['unexpected'], 0, 'stitch_failed', nowIso);
    expect(fromArray.validationReport.remediation_retry_count).toBe(1);
    expect(Array.isArray(fromArray.validationReport)).toBe(false);
  });
});

describe('filterGapsWithTranscript (2026-09-11 candidacy gate)', () => {
  const gap = (id: string, videoId: string): AnalysisGap => ({
    id,
    userId: 'u-1',
    videoId,
    title: 't',
    channelTitle: 'c',
    metadata: {},
    analysisMarkdown: markdownWithDimensions([1, 2]),
    analysisPayload: null,
    validationReport: { status: 'partial' },
    missingDimensions: Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => n > 2),
  });

  it('keeps candidates whose video_id has a transcripts row, drops purged/never-fetched ones', () => {
    const gaps = [gap('a', 'REALID1'), gap('b', 'X_archived_123.456'), gap('c', 'REALID2')];
    const kept = filterGapsWithTranscript(gaps, new Set(['REALID1', 'REALID2']));
    expect(kept.map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('drops everything when the transcripts set is empty (all purged)', () => {
    expect(filterGapsWithTranscript([gap('a', 'V1')], new Set())).toEqual([]);
  });
});

/** Thenable fake for the PostgREST query-builder chain (select → filters → terminal). */
type FakeTableConfig = {
  rows?: Array<Record<string, unknown>>;
  error?: unknown;
  /** Captures the full method-call chain for assertions. */
  calls?: string[];
};

function fakeServiceClient(tables: Record<string, FakeTableConfig>) {
  return {
    from: (table: string) => {
      const cfg = tables[table] ?? {};
      const callChain = cfg.calls ?? [];
      const builder: Record<string, unknown> = {
        select: (..._cols: unknown[]) => {
          callChain.push('select');
          return builder;
        },
        eq: (col: string, val: unknown) => {
          callChain.push(`eq:${col}=${String(val)}`);
          return builder;
        },
        or: (expr: string) => {
          callChain.push(`or:${expr}`);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          callChain.push(`in:${col}=[${vals.join(',')}]`);
          return builder;
        },
        order: (col: string, opts: unknown) => {
          callChain.push(`order:${col}:${JSON.stringify(opts ?? {})}`);
          return builder;
        },
        limit: (n: number) => {
          callChain.push(`limit:${n}`);
          return Promise.resolve({ data: cfg.rows ?? [], error: cfg.error ?? null });
        },
        update: (patch: Record<string, unknown>, _opts: unknown) => {
          callChain.push(`update:${JSON.stringify(patch)}`);
          return builder;
        },
        then: (resolve: (val: { data: Array<Record<string, unknown>>; error: unknown }) => unknown) =>
          Promise.resolve(resolve({ data: cfg.rows ?? [], error: cfg.error ?? null })),
      };
      return builder;
    },
  };
}

describe('findAnalysesWithMissingDimensions — transcript-presence gate (integration, mocked client)', () => {
  const rowFor = (id: string, videoId: string) => ({
    id,
    video_id: videoId,
    title: 't',
    channel_title: 'c',
    analysis_markdown: markdownWithDimensions([1, 2, 3]),
    analysis_payload: null,
    validation_report: { status: 'partial' },
    billing_status: 'failed',
    user_id: 'u-1',
  });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/supabase');
    vi.restoreAllMocks();
  });

  it('excludes candidates whose video_id has no transcripts row (2026-09-01 incident shape)', async () => {
    const fromCalls: Record<string, string[]> = {};
    const client = fakeServiceClient({
      analyses: { rows: [rowFor('live-1', 'LIVEID'), rowFor('purged-1', 'PURGEDID'), rowFor('arch-1', 'X_archived_999.1')], calls: (fromCalls.analyses = []) },
      transcripts: { rows: [{ video_id: 'LIVEID' }, { video_id: 'PURGEDID' }], calls: (fromCalls.transcripts = []) },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    const gaps = await mod.findAnalysesWithMissingDimensions();
    // 'arch-1' (mangled archived video_id, no transcript row ever) is excluded;
    // 'purged-1' still HAS a transcripts row here — the transcripts table is the
    // source of truth, purge is what removes it (this assertion pins that the
    // gate keys on row presence, not the id shape).
    expect(gaps.map((g) => g.id)).toEqual(['live-1', 'purged-1']);
    expect(fromCalls.transcripts).toContain('in:video_id=[LIVEID,PURGEDID,X_archived_999.1]');
  });

  it('throws (fail closed) when the transcripts presence query itself fails', async () => {
    const client = fakeServiceClient({
      analyses: { rows: [rowFor('live-1', 'LIVEID')] },
      transcripts: { error: new Error('transcripts query failed') },
    });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => client }));

    const mod = await import('@/lib/services/dimension-remediation');
    await expect(mod.findAnalysesWithMissingDimensions()).rejects.toThrow('transcripts query failed');
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

  function loadWithMocks(opts: { recordRemediationFailure?: ReturnType<typeof vi.fn> } = {}) {
    const recordRemediationFailure = opts.recordRemediationFailure ?? vi.fn().mockResolvedValue({ updated: true });
    vi.doMock('@/lib/redis', () => ({
      tryConsumeTokenBucket: vi.fn().mockResolvedValue(true),
      incrementRedisValue: vi.fn().mockResolvedValue(1),
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
    vi.doMock('@/lib/adapters/SupabaseBillingAdapter', () => ({
      SupabaseBillingAdapter: { logUsageEvent: vi.fn().mockResolvedValue(undefined) },
    }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        recordRemediationFailure = recordRemediationFailure;
        updateAnalysisResult = vi.fn().mockResolvedValue({ updated: true });
      },
    }));
    return { recordRemediationFailure };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/redis');
    vi.doUnmock('@/lib/stream-token');
    vi.doUnmock('@/lib/env');
    vi.doUnmock('@/lib/adapters/SupabaseSettingsAdapter');
    vi.doUnmock('@/lib/adapters/SupabaseBillingAdapter');
    vi.doUnmock('@/lib/adapters');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('worker returning non-2xx records the failure and burns one retry (was unbounded before 2026-09-11)', async () => {
    const { recordRemediationFailure } = loadWithMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue('worker exploded') })
    );

    const mod = await import('@/lib/services/dimension-remediation');
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], { capacityCents: 200, costPer1K: 0.0008 });
    expect(result.stage).toBe(mod.RemediationStage.WorkerFailed);
    expect(recordRemediationFailure).toHaveBeenCalledTimes(1);
    const call = recordRemediationFailure.mock.calls[0]?.[0] as {
      analysisId: string;
      previousRetryCount: number;
      guardBillingStatus: string;
      validationReport: Record<string, unknown>;
    };
    expect(call.analysisId).toBe('gap-1');
    expect(call.previousRetryCount).toBe(0);
    expect(call.guardBillingStatus).toBe('failed');
    expect(call.validationReport.remediation_retry_count).toBe(1);
    expect(call.validationReport.remediation_last_failure_stage).toBe('worker_failed');
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
    const result = await mod.remediateAnalysis(gap, ['m1'], [{ model: 'm1', name: 'M1' }], { capacityCents: 200, costPer1K: 0.0008 });
    // gap has dims 1..2 present; dim 3 arrives → still partial (9 missing) but
    // the attempt itself SUCCEEDED — the failure counter must stay untouched
    // (StillPartial's own increment flows through updateAnalysisResult, as before).
    expect(result.stage).toBe(mod.RemediationStage.StillPartial);
    expect(recordRemediationFailure).not.toHaveBeenCalled();
  });
});
