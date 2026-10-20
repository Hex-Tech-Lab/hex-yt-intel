/** R3b 2.5c: K>1 cell rows -> one reduced row per bundle (pure). */
import { describe, it, expect } from 'vitest';
import { reduceCellsToBundleRows, type CellRow } from '@/lib/jev/reduce-cells';

const SHA = 'a'.repeat(64);
// K=2 over 2 grounded bundles (1, 2) + projective bundle 3. Chunk 0 = words 0-100, chunk 1 = 100-300.
const PLAN = {
  K: 2,
  streamCount: 5,
  cells: [
    { jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 100, sha256: SHA },
    { jevChunkIndex: 1, chunkIndex: 1, startWord: 100, endWord: 300, sha256: SHA },
    { jevChunkIndex: 0, chunkIndex: 2, startWord: 0, endWord: 100, sha256: SHA },
    { jevChunkIndex: 1, chunkIndex: 2, startWord: 100, endWord: 300, sha256: SHA },
    { jevChunkIndex: 0, chunkIndex: 3, startWord: 0, endWord: 0, sha256: SHA },
  ],
};

const dim = (number: number, content: string, confidence?: number) =>
  ({ number, name: `D${number}`, content, ...(confidence !== undefined ? { metadata: { confidence } } : {}) });
const row = (jev: number, chunk: number, status: CellRow['status'], dims: unknown[] | null, extra: Partial<CellRow> = {}): CellRow => ({
  jev_chunk_index: jev,
  chunk_index: chunk,
  dimensions_covered: [],
  payload: dims === null ? {} : { schemaVersion: '2.0', persona: { tag: `p${jev}` }, dimensions: dims },
  status,
  updated_at: `2026-10-02T10:0${jev}:00Z`,
  tokens_used: 10,
  cost_usd: 0.5,
  ...extra,
});

const FULL: CellRow[] = [
  row(0, 1, 'completed', [dim(1, 'a0', 0.2), dim(2, 'b0')]),
  row(1, 1, 'completed', [dim(1, 'a1', 0.8), dim(2, 'b1')]),
  row(0, 2, 'completed', [dim(3, 'c0')]),
  row(1, 2, 'completed', [dim(3, 'c1')]),
  row(0, 3, 'completed', [dim(9, 'proj')]),
];

describe('reduceCellsToBundleRows', () => {
  it('no plan, malformed plan or K=1: no rows (the caller stays on the K=1 path)', () => {
    expect(reduceCellsToBundleRows(null, FULL)).toEqual({ rows: [], partialDimensions: [] });
    expect(reduceCellsToBundleRows({ ...PLAN, K: 1 }, FULL)).toEqual({ rows: [], partialDimensions: [] });
  });

  it('every cell completed: one reduced row per bundle, in bundle order, weights from the plan', () => {
    const { rows, partialDimensions } = reduceCellsToBundleRows(PLAN, FULL);
    expect(rows.map((bundle) => bundle.chunk_index)).toEqual([1, 2, 3]);
    expect(rows.every((bundle) => bundle.status === 'completed')).toBe(true);
    const bundle1 = rows[0];
    const dims = (bundle1?.payload.dimensions ?? []) as Array<{ number: number; content: string; metadata?: { confidence?: number } }>;
    expect(dims.map((dimension) => dimension.content)).toEqual(['a0\n\na1', 'b0\n\nb1']);
    // word-weighted: (0.2*100 + 0.8*200) / 300 = 0.6
    expect(dims[0]?.metadata?.confidence).toBe(0.6);
    // base payload = lowest jev cell's, with the reduced dimensions on top
    expect(bundle1?.payload.persona).toEqual({ tag: 'p0' });
    expect(bundle1?.tokens_used).toBe(20);
    expect(bundle1?.cost_usd).toBe(1);
    expect(bundle1?.updated_at).toBe('2026-10-02T10:01:00Z');
    expect(partialDimensions).toEqual([]);
  });

  it('a bundle with a missing or interrupted cell is omitted (the caller keeps waiting)', () => {
    const missing = reduceCellsToBundleRows(PLAN, FULL.filter((cell) => !(cell.jev_chunk_index === 1 && cell.chunk_index === 2)));
    expect(missing.rows.map((bundle) => bundle.chunk_index)).toEqual([1, 3]);
    const interrupted = reduceCellsToBundleRows(PLAN, FULL.map((cell) => (cell.jev_chunk_index === 1 && cell.chunk_index === 1 ? { ...cell, status: 'interrupted' as const } : cell)));
    expect(interrupted.rows.map((bundle) => bundle.chunk_index)).toEqual([2, 3]);
  });

  it('a failed cell makes its dimensions partial; the bundle still completes from the other chunk', () => {
    const cells = FULL.map((cell) => (cell.jev_chunk_index === 1 && cell.chunk_index === 1 ? { ...cell, status: 'failed' as const } : cell));
    const { rows, partialDimensions } = reduceCellsToBundleRows(PLAN, cells);
    expect(rows[0]?.status).toBe('completed');
    expect(partialDimensions).toEqual([1, 2]);
  });

  it('a dimension one chunk omitted is partial', () => {
    const cells = FULL.map((cell) => (cell.jev_chunk_index === 1 && cell.chunk_index === 1 ? row(1, 1, 'completed', [dim(1, 'a1')]) : cell));
    expect(reduceCellsToBundleRows(PLAN, cells).partialDimensions).toEqual([2]);
  });

  it('every cell of a bundle failed or unusable: a failed bundle row with the accounting kept', () => {
    const cells = FULL.map((cell) => (cell.chunk_index === 2 ? { ...cell, status: 'failed' as const, payload: {} } : cell));
    const bundle2 = reduceCellsToBundleRows(PLAN, cells).rows.find((bundle) => bundle.chunk_index === 2);
    expect(bundle2).toMatchObject({ status: 'failed', payload: {}, tokens_used: 20, cost_usd: 1 });
  });

  it('the projective bundle (one cell) passes through unchanged', () => {
    const bundle3 = reduceCellsToBundleRows(PLAN, FULL).rows.find((bundle) => bundle.chunk_index === 3);
    expect(bundle3?.payload.dimensions).toEqual([dim(9, 'proj')]);
  });
});
