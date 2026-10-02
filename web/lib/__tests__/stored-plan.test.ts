/** R3b 2.5a: one rule for the cells an analysis expects before it can finalize. */
import { describe, it, expect } from 'vitest';
import { expectedCells, parseStoredPlan, cellKey, checkPersistCell, planToDegrade } from '@/lib/jev/stored-plan';

const SHA = 'a'.repeat(64);
const cell = (jevChunkIndex: number, chunkIndex: number) => ({ jevChunkIndex, chunkIndex, startWord: 0, endWord: 10, sha256: SHA });
const K2 = {
  K: 2,
  streamCount: 9,
  cells: [cell(1, 4), cell(0, 1), cell(0, 5), cell(1, 1), cell(0, 2), cell(0, 3), cell(0, 4), cell(1, 2), cell(1, 3)],
};
const TODAY = [1, 2, 3, 4, 5].map((chunkIndex) => ({ jevChunkIndex: 0, chunkIndex }));

describe('expectedCells', () => {
  it('K=1, no plan or a malformed plan: exactly today\'s five bundle cells', () => {
    expect(expectedCells(null, 5)).toEqual(TODAY);
    expect(expectedCells(undefined, 5)).toEqual(TODAY);
    expect(expectedCells({ K: 'x' }, 5)).toEqual(TODAY);
    expect(expectedCells({ ...K2, K: 1, streamCount: 5 }, 5)).toEqual(TODAY);
  });

  it('K>1: exactly the plan cells, sorted by (jevChunkIndex, chunkIndex)', () => {
    const cells = expectedCells(K2, 5);
    expect(cells.map(cellKey)).toEqual(['0:1', '0:2', '0:3', '0:4', '0:5', '1:1', '1:2', '1:3', '1:4']);
    expect(cells).toHaveLength(K2.streamCount);
  });

  it('parseStoredPlan rejects a bad sha256 or a negative index', () => {
    expect(parseStoredPlan({ ...K2, cells: [{ ...cell(0, 1), sha256: 'nothex' }] })).toBeNull();
    expect(parseStoredPlan({ ...K2, cells: [cell(-1, 1)] })).toBeNull();
    expect(parseStoredPlan(K2)?.K).toBe(2);
  });
});

describe('checkPersistCell (R3b 2.5b)', () => {
  it('v1/K=1 request: today\'s rule only, the plan is not consulted', () => {
    expect(checkPersistCell(K2, { chunkIndex: 3, totalChunks: 5 }, 5)).toEqual({ ok: true });
    expect(checkPersistCell(null, { chunkIndex: 3 }, 5)).toEqual({ ok: true });
    expect(checkPersistCell(null, { chunkIndex: 3, totalChunks: 9 }, 5)).toEqual({ ok: false, reason: 'legacy_total_mismatch' });
  });

  it('v2 request: must be an expected cell of a K>1 plan with totalChunks = streamCount', () => {
    expect(checkPersistCell(K2, { jevChunkIndex: 1, chunkIndex: 4, totalChunks: 9 }, 5)).toEqual({ ok: true });
    expect(checkPersistCell(K2, { jevChunkIndex: 1, chunkIndex: 5, totalChunks: 9 }, 5)).toEqual({ ok: false, reason: 'cell_not_expected' });
    expect(checkPersistCell(K2, { jevChunkIndex: 2, chunkIndex: 1, totalChunks: 9 }, 5)).toEqual({ ok: false, reason: 'cell_not_expected' });
    expect(checkPersistCell(K2, { jevChunkIndex: 0, chunkIndex: 1, totalChunks: 5 }, 5)).toEqual({ ok: false, reason: 'total_mismatch' });
    expect(checkPersistCell(K2, { jevChunkIndex: 0, totalChunks: 9 }, 5)).toEqual({ ok: false, reason: 'cell_not_expected' });
  });

  it('v2 request without a K>1 plan is rejected', () => {
    expect(checkPersistCell(null, { jevChunkIndex: 0, chunkIndex: 1, totalChunks: 5 }, 5)).toEqual({ ok: false, reason: 'no_k_gt_1_plan' });
    expect(checkPersistCell({ ...K2, K: 1, streamCount: 5 }, { jevChunkIndex: 0, chunkIndex: 1, totalChunks: 5 }, 5)).toEqual({ ok: false, reason: 'no_k_gt_1_plan' });
  });
});

describe('degraded plan (R3b 2.5 degradation hatch)', () => {
  const k2 = {
    K: 2,
    streamCount: 9,
    cells: [0, 1].flatMap((jevChunkIndex) => [1, 2, 3, 4].map((chunkIndex) => ({ jevChunkIndex, chunkIndex, startWord: 0, endWord: 10, sha256: 'a'.repeat(64) })))
      .concat([{ jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: 'b'.repeat(64) }]),
  };

  it('a degraded K>1 plan reads as K=1, so every reader expects today\'s 5 jev-0 bundles', () => {
    expect(parseStoredPlan({ ...k2, degraded: true })?.K).toBe(1);
    expect(expectedCells({ ...k2, degraded: true }, 5)).toEqual([1, 2, 3, 4, 5].map((chunkIndex) => ({ jevChunkIndex: 0, chunkIndex })));
    expect(expectedCells(k2, 5)).toHaveLength(9);
  });

  it('planToDegrade marks only an unmarked K>1 plan, preserving its fields', () => {
    expect(planToDegrade(k2)).toEqual({ ...k2, degraded: true });
    expect(planToDegrade({ ...k2, degraded: true })).toBeNull();
    expect(planToDegrade({ ...k2, K: 1, streamCount: 5 })).toBeNull();
    expect(planToDegrade(null)).toBeNull();
  });
});
