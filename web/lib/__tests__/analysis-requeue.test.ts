/**
 * Analysis Requeue (ADR 021 Phase 3) — the requeue-partial middle branch.
 *
 * A stuck `processing` row the markdown path would fail may still hold
 * genuinely-persisted dimensions in `analysis_chunks` (Phase 1's
 * `dimensions_covered` checkpoint). decideRequeuePartial decides the NEW
 * middle outcome between the two existing terminal ones: requeue (keep the
 * row in `processing`, record exactly which dimensions are missing, burn one
 * remediation retry) instead of finalize-with-whatever's-there or discard.
 *
 * Covers pure decision + patch-builder contracts, chunk trust verification,
 * atomic CAS update queries, and sweep-level fault-isolation wiring.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  decideRequeuePartial,
  buildRequeuePatch,
  extractPayloadDimensionNumbers,
  isAmbiguousTransportError,
  MIN_SALVAGEABLE_DIMENSIONS,
} from '@/lib/services/analysis-requeue';
import { type ChunkRow } from '@/lib/services/analysis-reaper';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import type { SupabasePersistenceAdapter } from '@/lib/adapters';

describe('decideRequeuePartial (ADR 021 Phase 3)', () => {
  const MAX_RETRIES = 3;

  it('requeues a stuck row with some (3/11) dimensions covered while retries remain', () => {
    const decision = decideRequeuePartial([1, 2, 3], 1, MAX_RETRIES);
    if (decision === null) throw new Error('expected a requeue-partial decision');
    expect(decision.outcome).toBe('requeue-partial');
    expect(decision.missingDimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('still fails (null) a stuck row with 0/11 dimensions covered — unchanged behavior', () => {
    expect(decideRequeuePartial([], 0, MAX_RETRIES)).toBeNull();
  });

  it('still fails (null) when the retry ceiling is already hit — the ceiling must actually gate requeue', () => {
    expect(decideRequeuePartial([1, 2, 3], MAX_RETRIES, MAX_RETRIES)).toBeNull();
    expect(decideRequeuePartial([1, 2, 3], MAX_RETRIES + 1, MAX_RETRIES)).toBeNull();
  });

  it('still finalizes (null) a row already meeting MIN_SALVAGEABLE_DIMENSIONS — existing salvage path unchanged', () => {
    const covered = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_ignored, index) => index + 1);
    expect(decideRequeuePartial(covered, 0, MAX_RETRIES)).toBeNull();
  });

  it('dedupes the covered set — duplicate covered numbers must not inflate the count', () => {
    const decision = decideRequeuePartial([3, 3, 1], 0, MAX_RETRIES);
    if (decision === null) throw new Error('expected a requeue-partial decision');
    expect(decision.missingDimensions).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('ignores out-of-range covered numbers — only 1..TOTAL_DIMENSIONS count as covered', () => {
    const decision = decideRequeuePartial([0, 12, 99, 1], 0, MAX_RETRIES);
    if (decision === null) throw new Error('expected a requeue-partial decision');
    expect(decision.missingDimensions).not.toContain(1);
    expect(decision.missingDimensions).toHaveLength(TOTAL_DIMENSIONS - 1);
  });
});

describe('buildRequeuePatch (ADR 021 Phase 3)', () => {
  const nowIso = '2026-09-09T00:00:00.000Z';

  it('keeps the row in processing and records missing dimensions + incremented retry count', () => {
    const { outcome, patch } = buildRequeuePatch([4, 5], { persona: 'p1', status: 'processing', remediation_retry_count: 1 }, 2, nowIso);
    expect(outcome).toBe('requeue-partial');
    expect(patch.billing_status).toBe('processing');
    expect(patch.validation_passed).toBe(false);
    expect(patch.updated_at).toBe(nowIso);
    expect(patch.validation_report).toMatchObject({
      persona: 'p1', status: 'partial', requeue_partial: true,
      requeue_missing_dimensions: [4, 5], requeued_at: nowIso, remediation_retry_count: 2,
    });
  });

  it('never writes reaped markers — a requeue is not a terminal reap', () => {
    const { patch } = buildRequeuePatch([4], null, 1, nowIso);
    expect(patch.validation_report).not.toHaveProperty('reaped');
    expect(patch.validation_report).not.toHaveProperty('reaped_at');
    expect(patch.validation_report).not.toHaveProperty('reaped_via');
  });

  it('tolerates a non-plain-object (array) prior report instead of spreading it', () => {
    const { patch } = buildRequeuePatch([4], ['unexpected'], 1, nowIso);
    expect(patch.validation_report).toMatchObject({ status: 'partial', requeue_partial: true, remediation_retry_count: 1 });
    expect(Array.isArray(patch.validation_report)).toBe(false);
  });
});

describe('extractPayloadDimensionNumbers', () => {
  it('returns empty Set for null, non-objects, or missing dimensions', () => {
    expect(extractPayloadDimensionNumbers(null).size).toBe(0);
    expect(extractPayloadDimensionNumbers(undefined).size).toBe(0);
    expect(extractPayloadDimensionNumbers('not an object').size).toBe(0);
    expect(extractPayloadDimensionNumbers({}).size).toBe(0);
    expect(extractPayloadDimensionNumbers({ dimensions: 'not-an-array' }).size).toBe(0);
  });

  it('extracts numbers from items using number, dimensionNumber, or dimension keys', () => {
    const payload = {
      dimensions: [
        { number: 1 }, { dimensionNumber: 2 }, { dimension: 3 },
        { invalid: 'foo' }, null, 'string', { number: 4.5 },
      ],
    };
    const set = extractPayloadDimensionNumbers(payload);
    expect(Array.from(set).sort((first, second) => first - second)).toEqual([1, 2, 3]);
  });
});

describe('isAmbiguousTransportError', () => {
  it('identifies transient network and timeout errors', () => {
    expect(isAmbiguousTransportError(new Error('Connection timeout'))).toBe(true);
    expect(isAmbiguousTransportError(new Error('fetch failed: ECONNRESET'))).toBe(true);
    expect(isAmbiguousTransportError(new Error('The operation was aborted'))).toBe(true);
    expect(isAmbiguousTransportError({ message: 'Gateway Timeout', code: 504 })).toBe(true);
    expect(isAmbiguousTransportError({ message: 'Bad Gateway', code: '502' })).toBe(true);
    expect(isAmbiguousTransportError({ message: 'Service Unavailable', code: '503' })).toBe(true);
  });

  it('rejects definitive database or schema errors', () => {
    expect(isAmbiguousTransportError(new Error('relation "analyses" does not exist'))).toBe(false);
    expect(isAmbiguousTransportError(new Error('duplicate key value violates unique constraint'))).toBe(false);
    expect(isAmbiguousTransportError({ message: 'permission denied', code: '42501' })).toBe(false);
    expect(isAmbiguousTransportError(null)).toBe(false);
    expect(isAmbiguousTransportError(undefined)).toBe(false);
  });
});

describe('tryRequeuePartial (trust verification & atomic CAS)', () => {
  // skipcq: JS-0067
  function createMockAdapter(chunks: unknown[] | null) {
    return {
      findAnalysisChunks: vi.fn().mockResolvedValue(chunks),
    } as unknown as SupabasePersistenceAdapter;
  }

  // skipcq: JS-0067
  async function runRequeueTest(opts: {
    chunks: unknown[];
    report: Record<string, unknown> | null;
    updateResult?: { error: unknown; count: number | null };
  }) {
    vi.resetModules();
    const capturedEq: [string, string][] = [];
    const capturedOr: string[] = [];

    vi.doMock('@/lib/supabase', () => ({
      getSupabaseServiceClient: () => ({
        from: () => ({
          update: () => {
            // skipcq: JS-0067
            const updateBuilder: Record<string, unknown> = {
              eq: (fieldName: string, fieldValue: string) => {
                capturedEq.push([fieldName, fieldValue]);
                return updateBuilder;
              },
              or: (filterStr: string) => {
                capturedOr.push(filterStr);
                return updateBuilder;
              },
              then: (resolve: (val: unknown) => unknown) =>
                Promise.resolve(resolve(opts.updateResult ?? { error: null, count: 1 })),
            };
            return updateBuilder;
          },
        }),
      }),
    }));

    const { tryRequeuePartial: fn } = await import('@/lib/services/analysis-requeue');
    const result = await fn({ id: 'row-1', validation_report: opts.report }, createMockAdapter(opts.chunks), 3);
    return { result, capturedEq, capturedOr };
  }

  it('rejects dimensions from chunks where payload does not match dimensions_covered', async () => {
    const chunk = {
      chunk_index: 1, status: 'completed', dimensions_covered: [1, 2],
      payload: { dimensions: [{ number: 1, name: 'D1' }] },
    };
    const { result, capturedOr } = await runRequeueTest({ chunks: [chunk], report: null });
    expect(result).toBe('requeued');
    expect(capturedOr).toContain(
      'validation_report->>remediation_retry_count.is.null,validation_report->>remediation_retry_count.eq.0'
    );
  });

  it('uses specific retry count in CAS filter for subsequent retries', async () => {
    const chunk = {
      chunk_index: 1, status: 'completed', dimensions_covered: [1],
      payload: { dimensions: [{ number: 1, name: 'D1' }] },
    };
    const { result, capturedEq } = await runRequeueTest({
      chunks: [chunk], report: { remediation_retry_count: 2 },
    });
    expect(result).toBe('requeued');
    expect(capturedEq).toEqual(
      expect.arrayContaining([['validation_report->>remediation_retry_count', '2']])
    );
  });

  it('returns raced when CAS update count is 0', async () => {
    const chunk = {
      chunk_index: 1, status: 'completed', dimensions_covered: [1],
      payload: { dimensions: [{ number: 1, name: 'D1' }] },
    };
    const { result } = await runRequeueTest({
      chunks: [chunk], report: null, updateResult: { error: null, count: 0 },
    });
    expect(result).toBe('raced');
  });

  it('returns error on definitive DB errors and unknown on transport errors', async () => {
    const chunk = {
      chunk_index: 1, status: 'completed', dimensions_covered: [1],
      payload: { dimensions: [{ number: 1, name: 'D1' }] },
    };
    const { result: resDefinitive } = await runRequeueTest({
      chunks: [chunk], report: null,
      updateResult: { error: new Error('Postgres constraint violation'), count: null },
    });
    expect(resDefinitive).toBe('error');

    const { result: resTransport } = await runRequeueTest({
      chunks: [chunk], report: null,
      updateResult: { error: new Error('fetch failed: timeout'), count: null },
    });
    expect(resTransport).toBe('unknown');
  });
});

describe('sweepStuckAnalyses — requeue-partial wiring (ADR 021 Phase 3)', () => {
  interface PortChunkRow {
    chunk_index: number;
    dimensions_covered: number[];
    payload: Record<string, unknown>;
    status: 'completed' | 'failed' | 'interrupted';
    updated_at: string | null;
  }

  // skipcq: JS-0067
  function portChunk(index: number, covered: number[], overrides?: Partial<PortChunkRow>): PortChunkRow {
    return {
      chunk_index: index, dimensions_covered: covered,
      payload: { dimensions: covered.map(dimNum => ({ number: dimNum, name: `D${dimNum}`, content: `Body ${dimNum}.` })) },
      status: 'completed', updated_at: null, ...overrides,
    };
  }

  // skipcq: JS-0067
  async function loadWithSweepMocks(opts: {
    stuckRows: Array<{ id: string; analysis_markdown: string | null; validation_report: Record<string, unknown> | null; created_at?: string | null; updated_at?: string | null }>;
    tryRecoveryChunkRows: ChunkRow[];
    portChunkRows: PortChunkRow[] | null;
    findAnalysisChunksMock?: ReturnType<typeof vi.fn>;
    updateResult?: { error: unknown; count: number | null };
    selectError?: unknown;
    registrySettingsMock?: ReturnType<typeof vi.fn>;
  }) {
    vi.resetModules();
    const updateCalls: Array<Record<string, unknown>> = [];

    const fromMock = vi.fn((table: string) => {
      if (table === 'analysis_chunks') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: opts.tryRecoveryChunkRows, error: null }) }),
        };
      }
      return {
        select: () => {
          // skipcq: JS-0067
          const selectBuilder: Record<string, unknown> = {
            eq: () => selectBuilder, or: () => selectBuilder, lt: () => selectBuilder,
            limit: () => Promise.resolve({ data: opts.stuckRows, error: opts.selectError ?? null }),
            then: (resolve: (val: unknown) => unknown) => Promise.resolve(resolve({ data: opts.stuckRows, error: opts.selectError ?? null })),
          };
          return selectBuilder;
        },
        update: (patch: Record<string, unknown>) => {
          updateCalls.push(patch);
          // skipcq: JS-0067
          const updateBuilder: Record<string, unknown> = {
            eq: () => updateBuilder, or: () => updateBuilder,
            then: (resolve: (val: unknown) => unknown) =>
              Promise.resolve(resolve({ data: null, error: opts.updateResult?.error ?? null, count: opts.updateResult?.count ?? 1 })),
          };
          return updateBuilder;
        },
      };
    });

    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => ({ from: fromMock }) }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        findAnalysisChunks = opts.findAnalysisChunksMock ?? vi.fn().mockResolvedValue(opts.portChunkRows);
        updateAnalysisResult = vi.fn().mockResolvedValue({ updated: true });
      },
    }));
    vi.doMock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
      SupabaseSettingsAdapter: {
        getRegistrySettings: opts.registrySettingsMock ?? vi.fn().mockResolvedValue({ 'remediation.maxRetries': 3 }),
      },
    }));

    const mod = await import('@/lib/services/analysis-reaper');
    return { sweepStuckAnalyses: mod.sweepStuckAnalyses, updateCalls };
  }

  it('requeues a would-be-failed row with 3/11 dimensions covered while retries remain', async () => {
    const belowThresholdChunk: ChunkRow = {
      chunk_index: 1, status: 'completed',
      payload: { dimensions: [1, 2, 3].map(dimNum => ({ number: dimNum, name: `D${dimNum}`, content: `Body ${dimNum}.` })) },
    };
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-1', analysis_markdown: null, validation_report: { persona: 'p1', remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [belowThresholdChunk], portChunkRows: [portChunk(1, [1, 2, 3])],
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.completed).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.billing_status).toBe('processing');
    const report = updateCalls[0]?.validation_report as Record<string, unknown>;
    expect(report.requeue_partial).toBe(true);
    expect(report.requeue_missing_dimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(report.remediation_retry_count).toBe(2);
  });

  it('still fails (unchanged) a stuck row with 0/11 dimensions covered', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-2', analysis_markdown: null, validation_report: null }],
      tryRecoveryChunkRows: [], portChunkRows: [portChunk(1, [], { status: 'interrupted' })],
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.billing_status).toBe('failed');
  });

  it('still fails when the retry ceiling is already hit, even with dimensions covered', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-3', analysis_markdown: null, validation_report: { remediation_retry_count: 3 } }],
      tryRecoveryChunkRows: [], portChunkRows: [portChunk(1, [1, 2, 3])],
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.billing_status).toBe('failed');
  });

  it('counts a lost guarded requeue write as raced without falling through to the failed settle', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [], portChunkRows: [portChunk(1, [1, 2, 3])],
      updateResult: { error: null, count: 0 },
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(0);
    expect(result.raced).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
  });

  it('counts an ambiguous update error on requeue as unknown without falling through to failed settle', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4b', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [], portChunkRows: [portChunk(1, [1, 2, 3])],
      updateResult: { error: new Error('connection timeout during update'), count: null },
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(0);
    expect(result.unknown).toBe(1);
    expect(result.raced).toBe(0);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
  });

  it('skips row and counts error when chunk retrieval throws, preventing terminal failed settle', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4-chunk-err', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [], portChunkRows: null,
      findAnalysisChunksMock: vi.fn().mockRejectedValue(new Error('chunk persistence network failure')),
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toBe(1);
    expect(updateCalls).toHaveLength(0);
  });

  it('re-throws when initial analyses select query fails', async () => {
    const { sweepStuckAnalyses } = await loadWithSweepMocks({
      stuckRows: [], tryRecoveryChunkRows: [], portChunkRows: null,
      selectError: new Error('database connection refused'),
    });

    await expect(sweepStuckAnalyses()).rejects.toThrow('database connection refused');
  });

  it('respects updated_at lease timestamp and ignores recently-updated rows', async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const oneMinuteAgo = new Date(Date.now() - 1 * 60_000).toISOString();

    const { sweepStuckAnalyses } = await loadWithSweepMocks({
      stuckRows: [
        {
          id: 'recently-updated', analysis_markdown: null, validation_report: null,
          created_at: thirtyMinutesAgo, updated_at: oneMinuteAgo,
        },
      ],
      tryRecoveryChunkRows: [], portChunkRows: [],
    });

    const result = await sweepStuckAnalyses({ graceMinutes: 15 });
    expect(result.scanned).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('recovers with fallback ceiling when resolveMaxRetries rejects, without aborting the sweep', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4c', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [], portChunkRows: [portChunk(1, [1, 2, 3])],
      registrySettingsMock: vi.fn().mockRejectedValue(new Error('Settings Registry unavailable')),
    });

    const result = await sweepStuckAnalyses();
    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.billing_status).toBe('processing');
  });

  it('never consults the requeue path for a row the markdown path salvages as completed', async () => {
    const md = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_unused, index) => `### DIMENSION ${index + 1}: X\n\nbody`).join('\n\n');
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-5', analysis_markdown: md, validation_report: null }],
      tryRecoveryChunkRows: [], portChunkRows: null,
    });

    const result = await sweepStuckAnalyses();
    expect(result.completed).toBe(1);
    expect(result.requeued).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.billing_status).toBe('completed');
  });
});
