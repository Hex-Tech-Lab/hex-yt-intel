/**
 * Analysis Requeue (ADR 021 Phase 3) — the requeue-partial middle branch.
 *
 * A stuck `processing` row the markdown path would fail may still hold
 * genuinely-persisted dimensions in `analysis_chunks` (Phase 1's
 * `dimensions_covered` checkpoint). decideRequeuePartial decides the NEW
 * middle outcome between the two existing terminal ones: requeue (keep the
 * row in `processing`, record exactly which dimensions are missing, burn one
 * remediation retry) instead of finalize-with-whatever's-there or discard.
 * The two existing paths' semantics must NOT change — the null-return cases
 * below are explicit regression guards for that.
 *
 * The sweep-level wiring (reaper loop → tryRequeuePartial → guarded write)
 * is exercised in analysis-reaper.test.ts — this file covers the pure
 * decision + patch-builder contracts.
 */
import { describe, it, expect, vi } from 'vitest';
import { decideRequeuePartial, buildRequeuePatch, MIN_SALVAGEABLE_DIMENSIONS } from '@/lib/services/analysis-requeue';
import { type ChunkRow } from '@/lib/services/analysis-reaper';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

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
    // An overrun (e.g. a double-increment race) must be gated just as hard.
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

/**
 * buildRequeuePatch — the requeue bookkeeping write. Same SettlePatch shape
 * as buildSettlePatch, but it is NOT a settle: billing_status stays
 * `processing` (the row must remain sweepable for the retry window / future
 * Phase 4 selective dispatch), and the report records the specific missing
 * dimensions plus the incremented shared `remediation_retry_count` — with no
 * `reaped` markers, since nothing was settled.
 */
describe('buildRequeuePatch (ADR 021 Phase 3)', () => {
  const nowIso = '2026-09-09T00:00:00.000Z';

  it('keeps the row in processing and records missing dimensions + incremented retry count', () => {
    const { outcome, patch } = buildRequeuePatch([4, 5], { persona: 'p1', status: 'processing', remediation_retry_count: 1 }, 2, nowIso);
    expect(outcome).toBe('requeue-partial');
    expect(patch.billing_status).toBe('processing');
    expect(patch.validation_passed).toBe(false);
    expect(patch.updated_at).toBe(nowIso);
    expect(patch.validation_report).toMatchObject({
      persona: 'p1',
      status: 'partial',
      requeue_partial: true,
      requeue_missing_dimensions: [4, 5],
      requeued_at: nowIso,
      remediation_retry_count: 2,
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

/**
 * sweepStuckAnalyses — requeue-partial wiring (ADR 021 Phase 3).
 *
 * Exercises the full sweep loop with mocked I/O: chunk recovery first (falls
 * through on a below-threshold partial set), then the markdown path (fails —
 * analysis_markdown is never populated for chunked analyses), then the NEW
 * requeue branch reading the checkpoint through findAnalysisChunks. Verifies
 * the guarded write leaves the row `processing` with the requeue state, and
 * that 0-covered / ceiling-hit rows still take the unchanged failed path.
 */
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
      chunk_index: index,
      dimensions_covered: covered,
      payload: { dimensions: covered.map(dimNum => ({ number: dimNum, name: `D${dimNum}`, content: `Body for dimension ${dimNum}.` })) },
      status: 'completed',
      updated_at: null,
      ...overrides,
    };
  }

  // skipcq: JS-0067
  async function loadWithSweepMocks(opts: {
    stuckRows: Array<{ id: string; analysis_markdown: string | null; validation_report: Record<string, unknown> | null }>;
    tryRecoveryChunkRows: ChunkRow[];
    portChunkRows: PortChunkRow[] | null;
    updateResult?: { error: unknown; count: number | null };
    registrySettingsMock?: ReturnType<typeof vi.fn>;
  }) {
    vi.resetModules();
    const updateCalls: Array<Record<string, unknown>> = [];

    const fromMock = vi.fn((table: string) => {
      if (table === 'analysis_chunks') {
        // tryChunkRecovery's direct query
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.tryRecoveryChunkRows, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            lt: () => ({
              limit: () => Promise.resolve({ data: opts.stuckRows, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => {
              updateCalls.push(patch);
              return Promise.resolve({ data: null, error: opts.updateResult?.error ?? null, count: opts.updateResult?.count ?? 1 });
            },
          }),
        }),
      };
    });

    vi.doMock('@/lib/supabase', () => ({
      getSupabaseServiceClient: () => ({ from: fromMock }),
    }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        findAnalysisChunks = vi.fn().mockResolvedValue(opts.portChunkRows);
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
      chunk_index: 1,
      status: 'completed',
      payload: { dimensions: [1, 2, 3].map(dimNum => ({ number: dimNum, name: `D${dimNum}`, content: `Body for dimension ${dimNum}.` })) },
    };
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-1', analysis_markdown: null, validation_report: { persona: 'p1', remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [belowThresholdChunk],
      portChunkRows: [portChunk(1, [1, 2, 3])],
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.completed).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].billing_status).toBe('processing');
    const report = updateCalls[0].validation_report as Record<string, unknown>;
    expect(report.requeue_partial).toBe(true);
    expect(report.requeue_missing_dimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(report.remediation_retry_count).toBe(2);
  });

  it('still fails (unchanged) a stuck row with 0/11 dimensions covered', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-2', analysis_markdown: null, validation_report: null }],
      tryRecoveryChunkRows: [],
      portChunkRows: [portChunk(1, [], { status: 'interrupted' })],
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].billing_status).toBe('failed');
  });

  it('still fails when the retry ceiling is already hit, even with dimensions covered', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-3', analysis_markdown: null, validation_report: { remediation_retry_count: 3 } }],
      tryRecoveryChunkRows: [],
      portChunkRows: [portChunk(1, [1, 2, 3])],
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].billing_status).toBe('failed');
  });

  it('counts a lost guarded requeue write as raced without falling through to the failed settle', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [],
      portChunkRows: [portChunk(1, [1, 2, 3])],
      updateResult: { error: null, count: 0 },
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(0);
    expect(result.raced).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
  });

  it('counts an ambiguous update error on requeue as raced without falling through to failed settle', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4b', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [],
      portChunkRows: [portChunk(1, [1, 2, 3])],
      updateResult: { error: new Error('connection timeout during update'), count: null },
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(0);
    expect(result.raced).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
  });

  it('recovers with fallback ceiling when resolveMaxRetries rejects, without aborting the sweep', async () => {
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-4c', analysis_markdown: null, validation_report: { remediation_retry_count: 1 } }],
      tryRecoveryChunkRows: [],
      portChunkRows: [portChunk(1, [1, 2, 3])],
      registrySettingsMock: vi.fn().mockRejectedValue(new Error('Settings Registry unavailable')),
    });

    const result = await sweepStuckAnalyses();

    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].billing_status).toBe('processing');
  });

  it('never consults the requeue path for a row the markdown path salvages as completed', async () => {
    const md = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_unused, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { sweepStuckAnalyses, updateCalls } = await loadWithSweepMocks({
      stuckRows: [{ id: 'a-5', analysis_markdown: md, validation_report: null }],
      tryRecoveryChunkRows: [],
      portChunkRows: null,
    });

    const result = await sweepStuckAnalyses();

    expect(result.completed).toBe(1);
    expect(result.requeued).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].billing_status).toBe('completed');
  });
});
