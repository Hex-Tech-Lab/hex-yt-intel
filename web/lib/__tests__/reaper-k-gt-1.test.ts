/** R3b 2.5d: reaper completeness and salvage for K>1 analyses. */
import { describe, it, expect, vi } from 'vitest';
import { cellsAreFullyComplete } from '@/lib/services/analysis-reap-policy';
import { settleCellsForSalvage, type CellRow } from '@/lib/jev/reduce-cells';
import { expectedCells } from '@/lib/jev/stored-plan';
import { TOTAL_STREAMS } from '@/lib/config/synthesis';

const SHA = 'a'.repeat(64);
const BUNDLES = [[1, 2, 3], [4, 5], [6, 7], [8, 10], [9, 11]];
// K=2: grounded bundles 1-4 over chunks 0/1, projective bundle 5.
const PLAN = {
  K: 2,
  streamCount: 9,
  cells: [
    ...[0, 1].flatMap((jev) => [1, 2, 3, 4].map((chunkIndex) => ({ jevChunkIndex: jev, chunkIndex, startWord: jev * 100, endWord: jev * 100 + 100, sha256: SHA }))),
    { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: SHA },
  ],
};
const EXPECTED = expectedCells(PLAN, TOTAL_STREAMS);

const cell = (jev: number, index: number, status: CellRow['status'] = 'completed'): CellRow => ({
  jev_chunk_index: jev,
  chunk_index: index,
  dimensions_covered: [],
  status,
  payload: status === 'completed' ? { dimensions: (BUNDLES[index - 1] ?? []).map((number) => ({ number, name: `D${number}`, content: `Body for dimension ${number} chunk ${jev} with enough length.` })) } : {},
  updated_at: null,
});
const fullSet = () => PLAN.cells.map((planCell) => cell(planCell.jevChunkIndex, planCell.chunkIndex));

describe('cellsAreFullyComplete', () => {
  it('true only for exactly the expected set, all completed with dimensions', () => {
    expect(cellsAreFullyComplete(fullSet(), EXPECTED)).toBe(true);
  });

  it('false for a sparse missing cell anywhere in the matrix', () => {
    expect(cellsAreFullyComplete(fullSet().filter((row) => !(row.jev_chunk_index === 1 && row.chunk_index === 2)), EXPECTED)).toBe(false);
  });

  it('false when an unexpected extra row exists (strict, unlike the parked WIP)', () => {
    expect(cellsAreFullyComplete([...fullSet(), cell(1, 5)], EXPECTED)).toBe(false);
    expect(cellsAreFullyComplete([...fullSet().slice(1), cell(2, 1)], EXPECTED)).toBe(false);
  });

  it('false for a failed/interrupted cell or one without a dimensions array', () => {
    for (const status of ['failed', 'interrupted'] as const) {
      expect(cellsAreFullyComplete(fullSet().map((row) => (row.jev_chunk_index === 1 && row.chunk_index === 1 ? cell(1, 1, status) : row)), EXPECTED)).toBe(false);
    }
    expect(cellsAreFullyComplete(fullSet().map((row) => (row.chunk_index === 3 ? { ...row, payload: {} } : row)), EXPECTED)).toBe(false);
  });

  it('false for a duplicated cell', () => {
    const rows = fullSet();
    expect(cellsAreFullyComplete([...rows.slice(1), rows[1] as CellRow], EXPECTED)).toBe(false);
  });
});

describe('settleCellsForSalvage', () => {
  it('missing and interrupted cells become failed; rows outside the plan are dropped', () => {
    const settled = settleCellsForSalvage(PLAN, [...fullSet().filter((row) => !(row.jev_chunk_index === 1 && row.chunk_index === 2)), cell(1, 5)].map((row) => (row.jev_chunk_index === 1 && row.chunk_index === 3 ? { ...row, status: 'interrupted' as const } : row)));
    expect(settled).toHaveLength(PLAN.cells.length);
    expect(settled.find((row) => row.jev_chunk_index === 1 && row.chunk_index === 2)?.status).toBe('failed');
    expect(settled.find((row) => row.jev_chunk_index === 1 && row.chunk_index === 3)?.status).toBe('failed');
    expect(settled.some((row) => row.jev_chunk_index === 1 && row.chunk_index === 5)).toBe(false);
  });
});

describe('tryChunkRecovery, K>1', () => {
  async function load(cells: CellRow[]) {
    vi.resetModules();
    const updateAnalysisResultMock = vi.fn().mockResolvedValue({ updated: true });
    vi.doMock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => ({ from: () => { throw new Error('K>1 recovery must not read jev-0 rows directly'); } }) }));
    vi.doMock('@/lib/adapters', () => ({
      SupabasePersistenceAdapter: class {
        updateAnalysisResult = updateAnalysisResultMock;
        findJevPlan = vi.fn().mockResolvedValue(PLAN);
        findAnalysisCells = vi.fn().mockResolvedValue(cells);
      },
    }));
    const mod = await import('@/lib/services/analysis-reaper');
    const { SupabasePersistenceAdapter } = await import('@/lib/adapters');
    return { tryChunkRecovery: mod.tryChunkRecovery, adapter: new SupabasePersistenceAdapter() as never, updateAnalysisResultMock };
  }

  it('a complete cell set recovers as a full set, every bundle reduced across its chunks', async () => {
    const { tryChunkRecovery, adapter, updateAnalysisResultMock } = await load(fullSet());
    expect(await tryChunkRecovery('a1', null, adapter)).toEqual({ outcome: 'completed' });
    const call = updateAnalysisResultMock.mock.calls[0][0];
    expect(call.validationReport.reaped_via).toBe('chunk_recovery');
    expect(call.payload.dimensions).toHaveLength(11);
    expect(JSON.stringify(call.payload)).toContain('chunk 0 with enough length.\\n\\nBody for dimension 4 chunk 1');
    expect(call.validationReport).not.toHaveProperty('jev_partial_dimensions');
  });

  it('a missing cell: not a full set; salvaged from the other chunk with partial dimensions recorded', async () => {
    const { tryChunkRecovery, adapter, updateAnalysisResultMock } = await load(fullSet().filter((row) => !(row.jev_chunk_index === 1 && row.chunk_index === 2)));
    // Every dimension survives from chunk 0, so the existing salvage policy
    // (billing on dimension completeness, same as the live finalize) settles
    // 'completed'; the partial coverage is recorded for the UI badge.
    expect(await tryChunkRecovery('a2', null, adapter)).toEqual({ outcome: 'completed' });
    const call = updateAnalysisResultMock.mock.calls[0][0];
    expect(call.validationReport.reaped_via).toBe('chunk_recovery_partial');
    expect(call.validationReport.jev_partial_dimensions).toEqual([4, 5]);
    expect(call.payload.dimensions).toHaveLength(11);
  });

  it('a whole bundle lost in every chunk: a real partial (missing dimensions, unbilled)', async () => {
    const { tryChunkRecovery, adapter, updateAnalysisResultMock } = await load(fullSet().filter((row) => row.chunk_index !== 2));
    expect(await tryChunkRecovery('a3', null, adapter)).toEqual({ outcome: 'failed' });
    const call = updateAnalysisResultMock.mock.calls[0][0];
    expect(call.payload.dimensions).toHaveLength(9);
    expect(call.validationReport.billing_status).toBe('failed');
  });
});
