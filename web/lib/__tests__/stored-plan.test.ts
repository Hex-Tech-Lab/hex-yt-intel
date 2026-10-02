/** R3b 2.5a: one rule for the cells an analysis expects before it can finalize. */
import { describe, it, expect } from 'vitest';
import { expectedCells, parseStoredPlan, cellKey } from '@/lib/jev/stored-plan';

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
