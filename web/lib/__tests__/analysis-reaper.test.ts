/**
 * Analysis Reaper — salvage-vs-fail decision.
 * The reaper settles stuck `processing` rows: rows with enough generated
 * dimensions are salvaged to `completed`, the rest are `failed`.
 * (billing_status enum: processing | completed | failed -- see
 * web/lib/types/validation-report.ts BillingStatus for the 2026-07-23 RCA on
 * why this is 3 states, not the previous 'pending'|'chargeable'|'charged'|'failed'.)
 */
import { describe, it, expect, vi } from 'vitest';
import { decideReapOutcome, buildSettlePatch, MIN_SALVAGEABLE_DIMENSIONS, chunksAreFullyComplete, type ChunkRow } from '@/lib/services/analysis-reaper';
import { TOTAL_STREAMS, TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/** Build markdown containing exactly `n` UCIS dimension headers (1..n). */
function markdownWithDimensions(n: number): string {
  return Array.from({ length: n }, (_, i) => `### DIMENSION ${i + 1}: Section ${i + 1}\n\nSome analysis content for dimension ${i + 1}.`).join('\n\n');
}

describe('decideReapOutcome', () => {
  it('fails an empty / null / whitespace analysis (the stuck-with-no-output case)', () => {
    expect(decideReapOutcome(null)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome(undefined)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('')).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('   \n  ')).toEqual({ outcome: 'failed', dimensionCount: 0 });
  });

  it('fails a below-threshold partial (fewer than the salvage minimum)', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS - 1);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS - 1);
    expect(outcome).toBe('failed');
  });

  it('salvages a partial that meets the salvage minimum', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS);
    expect(outcome).toBe('completed');
  });

  it('salvages a full 11-dimension analysis', () => {
    const { outcome, dimensionCount } = decideReapOutcome(markdownWithDimensions(11));
    expect(dimensionCount).toBe(11);
    expect(outcome).toBe('completed');
  });
});

describe('buildSettlePatch', () => {
  const nowIso = '2026-07-04T00:00:00.000Z';

  it('fails an empty analysis and preserves prior report fields', () => {
    const { outcome, patch } = buildSettlePatch(null, { persona: 'p1', status: 'processing' }, nowIso);
    expect(outcome).toBe('failed');
    expect(patch.billing_status).toBe('failed');
    expect(patch.validation_passed).toBe(false);
    expect(patch.validation_report).toMatchObject({ persona: 'p1', status: 'failed', reaped: true, reaped_dimensions: 0 });
  });

  // Note: outcome='completed' maps to billing_status='completed'

  it('marks a full analysis complete + validation_passed', () => {
    const md = Array.from({ length: 11 }, (_, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { outcome, patch } = buildSettlePatch(md, null, nowIso);
    expect(outcome).toBe('completed');
    expect(patch.billing_status).toBe('completed');
    expect(patch.validation_passed).toBe(true);
    expect(patch.validation_report.status).toBe('complete');
  });

  it('marks a usable partial completed-but-not-passed (status partial)', () => {
    const md = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { patch } = buildSettlePatch(md, null, nowIso);
    expect(patch.billing_status).toBe('completed');
    expect(patch.validation_passed).toBe(false);
    expect(patch.validation_report.status).toBe('partial');
  });

  it('ignores a non-plain-object (array) prior report instead of spreading it', () => {
    const { patch } = buildSettlePatch(null, ['unexpected'], nowIso);
    expect(patch.validation_report).toMatchObject({ status: 'failed', reaped: true });
    expect(Array.isArray(patch.validation_report)).toBe(false);
  });
});

/**
 * chunksAreFullyComplete — the gate deciding whether the reaper attempts
 * chunk-based recovery (re-stitching a genuinely complete-but-never-
 * finalized analysis) vs. falling through to the markdown-only heuristic.
 *
 * RCA this exists for (2026-07-23 live incident): a stuck analysis had all 5
 * bundle-stream chunks genuinely complete in `analysis_chunks`, but the
 * parent row's own finalize/stitch write was interrupted -- the OLD reaper,
 * blind to analysis_chunks, would eventually have marked a perfectly
 * complete 11/11 analysis 'failed' after the grace window. These tests
 * guard the exact edge cases identified before implementing: TOTAL_STREAMS
 * (bundle count) vs TOTAL_DIMENSIONS (dimension count) confusion, partial
 * chunk sets, and non-'completed' chunk statuses.
 */
describe('chunksAreFullyComplete', () => {
  function makeChunk(index: number, overrides?: Partial<ChunkRow>): ChunkRow {
    return {
      chunk_index: index,
      status: 'completed',
      payload: { dimensions: [{ number: index, name: 'X', content: 'body' }] },
      ...overrides,
    };
  }

  it('is true when all TOTAL_STREAMS chunks are present and completed', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(true);
  });

  it('is false when a chunk is missing (partial set) -- must fall through, not be treated as complete', () => {
    const rows = Array.from({ length: TOTAL_STREAMS - 1 }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when a present chunk has a non-completed status (e.g. interrupted)', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    rows[2] = makeChunk(3, { status: 'interrupted' });
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when a chunk payload has no dimensions array', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    rows[0] = makeChunk(1, { payload: { notDimensions: true } });
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when there are MORE than TOTAL_STREAMS rows (duplicate/corrupt data), not just fewer', () => {
    const rows = Array.from({ length: TOTAL_STREAMS + 1 }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false for an empty chunk list', () => {
    expect(chunksAreFullyComplete([])).toBe(false);
  });
});

/**
 * tryChunkRecovery — partial-chunk salvage path.
 *
 * RCA this exists for (2026-08-02, live production, video LTNVA2iP9YU): one
 * of TOTAL_STREAMS bundle-stream requests (chunk 2) returned HTTP 200 to the
 * browser but its worker-side persist call never landed a row in
 * `analysis_chunks`. The row was left stuck in `processing` with 4/5 chunks
 * (10/11 dimensions) genuinely complete. The OLD `tryChunkRecovery` bailed
 * out entirely on any incompleteness (`chunksAreFullyComplete` required all
 * TOTAL_STREAMS), falling through to the markdown-only path -- which sees 0
 * dimensions for a chunked analysis (analysis_markdown is never populated
 * until final stitch) and reaps the row as `failed` with nothing, discarding
 * 10 genuinely-complete dimensions. These tests guard the fix: a partial set
 * meeting MIN_SALVAGEABLE_DIMENSIONS is now stitched and salvaged instead of
 * discarded, while a partial set below the threshold still correctly falls
 * through (no regression).
 */
describe('tryChunkRecovery — partial-set salvage', () => {
  function makeChunk(index: number, dims: number[], overrides?: Partial<ChunkRow>): ChunkRow {
    return {
      chunk_index: index,
      status: 'completed',
      payload: { dimensions: dims.map(n => ({ number: n, name: `D${n}`, content: `Body for dimension ${n} with enough length.` })) },
      ...overrides,
    };
  }

  async function loadWithMocks(
    chunkRows: ChunkRow[],
    configureMock?: (mock: ReturnType<typeof vi.fn>) => void,
  ) {
    vi.resetModules();
    const updateAnalysisResultMock = vi.fn().mockResolvedValue({ updated: true });
    configureMock?.(updateAnalysisResultMock);

    vi.doMock('@/lib/supabase', () => ({
      getSupabaseServiceClient: () => ({
        from: (_table: string) => ({
          select: () => ({
            eq: () => Promise.resolve({ data: chunkRows, error: null }),
          }),
        }),
      }),
    }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        updateAnalysisResult = updateAnalysisResultMock;
      },
    }));

    const mod = await import('@/lib/services/analysis-reaper');
    const { SupabasePersistenceAdapter } = await import('@/lib/adapters');
    return { tryChunkRecovery: mod.tryChunkRecovery, persistenceAdapter: new SupabasePersistenceAdapter() as any, updateAnalysisResultMock };
  }

  it('salvages a 4/5-chunk (10/11-dimension) partial set that clears the salvage minimum', async () => {
    // Mirrors the live incident: chunk 2 missing, chunks 1/3/4/5 present.
    const rows = [
      makeChunk(1, [1]),
      makeChunk(3, [2, 4, 6]),
      makeChunk(4, [5, 7, 10]),
      makeChunk(5, [3, 9, 11]),
    ];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows);

    const result = await tryChunkRecovery('analysis-1', { persona: 'creator' }, persistenceAdapter);

    expect(result).toEqual({ outcome: 'completed' });
    expect(updateAnalysisResultMock).toHaveBeenCalledTimes(1);
    const callArgs = updateAnalysisResultMock.mock.calls[0][0];
    expect(callArgs.payload.dimensions).toHaveLength(TOTAL_DIMENSIONS - 1); // 10 dims recovered
    expect(callArgs.validationReport.billing_status).toBe('completed');
    expect(callArgs.validationReport.status).toBe('partial'); // not the full 11
    expect(callArgs.validationReport.reaped_via).toBe('chunk_recovery_partial');
    expect(callArgs.markdown.length).toBeGreaterThan(0); // content actually preserved, not discarded
  });

  it('falls through (returns null) when the partial set is below the salvage minimum', async () => {
    // Only 1 dimension recovered -- below MIN_SALVAGEABLE_DIMENSIONS.
    const rows = [makeChunk(1, [1])];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows);

    const result = await tryChunkRecovery('analysis-2', null, persistenceAdapter);

    expect(result).toBeNull();
    expect(updateAnalysisResultMock).not.toHaveBeenCalled();
  });

  it('returns null when there are no completed chunks at all (nothing to salvage)', async () => {
    const rows = [makeChunk(1, [1], { status: 'interrupted' })];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows);

    const result = await tryChunkRecovery('analysis-3', null, persistenceAdapter);

    expect(result).toBeNull();
    expect(updateAnalysisResultMock).not.toHaveBeenCalled();
  });

  it('still applies the strict full-set policy (100%-or-failed billing) when all TOTAL_STREAMS chunks are complete', async () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1, [i + 1]));
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows);

    const result = await tryChunkRecovery('analysis-4', null, persistenceAdapter);

    // Only TOTAL_STREAMS (5) dimensions recovered here, well under TOTAL_DIMENSIONS (11)
    // -- the full-set path's buildDimensionStatus policy still fails billing
    // in that case (unchanged behavior from before this fix).
    expect(result).toEqual({ outcome: 'failed' });
    const callArgs = updateAnalysisResultMock.mock.calls[0][0];
    expect(callArgs.validationReport.reaped_via).toBe('chunk_recovery');
  });

  it('ignores a completed chunk with a malformed (missing/non-array) dimensions payload when salvaging a partial set', async () => {
    // chunk_index 2 exists and is 'completed' but its payload.dimensions is
    // null -- malformed, not simply missing. Its "would-be" dimension (8) is
    // deliberately the one NOT covered by the 4 valid chunks below, so if the
    // filter in tryChunkRecovery failed to exclude it, dimension 8 would show
    // up in the stitched result and the salvage would (wrongly) read as the
    // full 11/11 set instead of a 10/11 partial.
    const malformedChunk = makeChunk(2, [8], { payload: { dimensions: null } });
    const validRows = [
      makeChunk(1, [1]),
      makeChunk(3, [2, 4, 6]),
      makeChunk(4, [5, 7, 10]),
      makeChunk(5, [3, 9, 11]),
    ];
    const rows = [malformedChunk, ...validRows];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows);

    const result = await tryChunkRecovery('analysis-5', null, persistenceAdapter);

    expect(result).toEqual({ outcome: 'completed' });
    const callArgs = updateAnalysisResultMock.mock.calls[0][0];
    expect(callArgs.payload.dimensions).toHaveLength(TOTAL_DIMENSIONS - 1); // 10, not 11
    expect(callArgs.payload.dimensions.some((d: { number: number }) => d.number === 8)).toBe(false);
    expect(callArgs.validationReport.status).toBe('partial'); // not 'done' -- proves dim 8 didn't leak in
  });

  it('retries updateAnalysisResult on a transient failure and still salvages on the second attempt', async () => {
    const rows = [
      makeChunk(1, [1]),
      makeChunk(3, [2, 4, 6]),
      makeChunk(4, [5, 7, 10]),
      makeChunk(5, [3, 9, 11]),
    ];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows, mock => {
      mock.mockReset();
      mock.mockRejectedValueOnce(new Error('transient write failure')).mockResolvedValueOnce({ updated: true });
    });

    const result = await tryChunkRecovery('analysis-6', null, persistenceAdapter);

    expect(result).toEqual({ outcome: 'completed' });
    expect(updateAnalysisResultMock).toHaveBeenCalledTimes(2);
  });

  it('propagates the error after exhausting retries on a permanent updateAnalysisResult failure (caller falls back to markdown path)', async () => {
    const rows = [
      makeChunk(1, [1]),
      makeChunk(3, [2, 4, 6]),
      makeChunk(4, [5, 7, 10]),
      makeChunk(5, [3, 9, 11]),
    ];
    const { tryChunkRecovery, persistenceAdapter, updateAnalysisResultMock } = await loadWithMocks(rows, mock => {
      mock.mockReset();
      mock.mockRejectedValue(new Error('permanent write failure'));
    });

    await expect(tryChunkRecovery('analysis-7', null, persistenceAdapter)).rejects.toThrow('permanent write failure');
    // Bounded retry (maxAttempts=2): exactly 2 attempts, not an unbounded loop.
    expect(updateAnalysisResultMock).toHaveBeenCalledTimes(2);
  });
});
