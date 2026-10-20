import { describe, it, expect, vi } from 'vitest';
import { ProjectiveContextUseCase, type PersistedChunk } from '../ProjectiveContextUseCase';
import type { CellRow } from '@/lib/jev/reduce-cells';

const MAP = [[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]];
const chunk = (index: number, status: PersistedChunk['status'], dims: number[], extra: Record<string, unknown> = {}): PersistedChunk => ({
  chunk_index: index,
  dimensions_covered: dims,
  status,
  payload: { dimensions: dims.map((number) => ({ number, content: `content ${number}` })), ...extra },
});
const groundedChunks = () => [
  chunk(1, 'completed', [1, 10]),
  chunk(2, 'completed', [2, 4, 6]),
  chunk(3, 'completed', [5, 7]),
  chunk(4, 'completed', [3, 8], { explicitSpeakerResources: ['Book A'] }),
];

function build(opts: { owns?: boolean; chunks?: PersistedChunk[]; plan?: unknown; cells?: CellRow[] } = {}) {
  const sign = vi.fn().mockResolvedValue({ sig: 'SIG', exp: 123 });
  const findChunks = vi.fn().mockResolvedValue(opts.chunks ?? groundedChunks());
  const useCase = new ProjectiveContextUseCase({
    ownsAnalysis: vi.fn().mockResolvedValue(opts.owns ?? true),
    findChunks,
    findJevPlan: vi.fn().mockResolvedValue(opts.plan ?? null),
    findCells: vi.fn().mockResolvedValue(opts.cells ?? []),
    resolveSettings: vi.fn().mockResolvedValue({ streamBundles: MAP, priorPayloadMaxBytes: 65536, retryAfterMs: 1500, maxWaitMs: 20000 }),
    sign,
  });
  return { useCase, sign, findChunks };
}

describe('ProjectiveContextUseCase (R2b)', () => {
  it('404 for an analysis the caller does not own', async () => {
    const { useCase, sign } = build({ owns: false });
    expect(await useCase.execute({ analysisId: 'a', userId: 'u' })).toEqual({ type: 'not_found' });
    expect(sign).not.toHaveBeenCalled();
  });

  it('409 until EVERY grounded bundle has a persisted chunk (persist-ACK race closed)', async () => {
    const { useCase, sign } = build({ chunks: groundedChunks().filter((row) => row.chunk_index !== 3) });
    expect(await useCase.execute({ analysisId: 'a', userId: 'u' })).toEqual({ type: 'grounded_not_persisted', retryAfterMs: 1500, maxWaitMs: 20000 });
    expect(sign).not.toHaveBeenCalled();
  });

  it('builds grounded-only evidence from PERSISTED chunks, carries speaker resources, signs for the projective dims', async () => {
    const { useCase, sign } = build();
    const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
    expect(outcome.type).toBe('ok');
    if (outcome.type !== 'ok') return;
    const numbers = outcome.prior_payload.dimensions.map((dim) => dim.number).sort((left, right) => left - right);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(outcome.prior_payload.explicitSpeakerResources).toEqual(['Book A']);
    expect(outcome.projectiveDimensions).toEqual([9, 11]);
    expect(sign).toHaveBeenCalledWith({ analysisId: 'a', dimensions: [9, 11], priorPayload: outcome.prior_payload });
    expect(outcome.contextSig).toBe('SIG');
  });

  it('a terminally failed grounded chunk counts as settled (degraded) and contributes nothing', async () => {
    const rows = groundedChunks().map((row) => (row.chunk_index === 2 ? { ...row, status: 'failed' as const } : row));
    const { useCase } = build({ chunks: rows });
    const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
    expect(outcome.type).toBe('ok');
    if (outcome.type !== 'ok') return;
    expect(outcome.prior_payload.dimensions.map((dim) => dim.number)).not.toContain(2);
  });

  it('never lets a projective dimension leak into grounded evidence', async () => {
    const rows = groundedChunks();
    rows[0] = chunk(1, 'completed', [1, 10, 9]); // a malformed chunk carrying dim 9
    const { useCase } = build({ chunks: rows });
    const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
    if (outcome.type !== 'ok') throw new Error(outcome.type);
    expect(outcome.prior_payload.dimensions.map((dim) => dim.number)).not.toContain(9);
  });

  describe('K>1 (R3b 2.5d)', () => {
    const SHA = 'a'.repeat(64);
    // K=2: grounded bundles 1-4 over chunks 0/1, projective bundle 5.
    const PLAN = {
      K: 2,
      streamCount: 9,
      cells: [
        ...[0, 1].flatMap((jev) => [1, 2, 3, 4].map((chunkIndex) => ({ jevChunkIndex: jev, chunkIndex, startWord: jev * 100, endWord: jev * 100 + 100, sha256: SHA }))),
        { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: SHA },
      ],
    };
    const cell = (jev: number, index: number, status: CellRow['status']): CellRow => ({
      jev_chunk_index: jev,
      chunk_index: index,
      dimensions_covered: MAP[index - 1] ?? [],
      status,
      payload: status === 'completed' ? { dimensions: (MAP[index - 1] ?? []).map((number) => ({ number, content: `content ${number} chunk ${jev}` })) } : {},
      updated_at: null,
    });
    const allGrounded = (overrides: Record<string, CellRow['status']> = {}) =>
      [0, 1].flatMap((jev) => [1, 2, 3, 4].map((index) => cell(jev, index, overrides[`${jev}:${index}`] ?? 'completed')));

    it('409 until every grounded CELL is persisted; reads cells, never the chunk-0 rows', async () => {
      const { useCase, sign, findChunks } = build({ plan: PLAN, cells: allGrounded().filter((row) => !(row.jev_chunk_index === 1 && row.chunk_index === 3)) });
      expect(await useCase.execute({ analysisId: 'a', userId: 'u' })).toEqual({ type: 'grounded_not_persisted', retryAfterMs: 1500, maxWaitMs: 20000 });
      expect(sign).not.toHaveBeenCalled();
      expect(findChunks).not.toHaveBeenCalled();
    });

    it('builds prior_payload from the REDUCED grounded output (both chunks per dimension)', async () => {
      const { useCase } = build({ plan: PLAN, cells: allGrounded() });
      const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
      expect(outcome.type).toBe('ok');
      expect(JSON.stringify(outcome)).toContain('content 4 chunk 0\\n\\ncontent 4 chunk 1');
    });

    it('degradation hatch: a degraded K>1 plan (browser ran K=1) reads the jev-0 bundle rows at once, no 409 wait', async () => {
      const { useCase, findChunks } = build({ plan: { ...PLAN, degraded: true }, cells: [] });
      const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
      expect(outcome.type).toBe('ok');
      expect(findChunks).toHaveBeenCalled();
    });

    it('an interrupted cell counts as settled (degraded), like an interrupted K=1 bundle', async () => {
      const { useCase } = build({ plan: PLAN, cells: allGrounded({ '1:3': 'interrupted' }) });
      const outcome = await useCase.execute({ analysisId: 'a', userId: 'u' });
      expect(outcome.type).toBe('ok');
      // Bundle 3 (dims 5, 7) lost its chunk-1 cell: only chunk 0 contributes.
      expect(JSON.stringify(outcome)).toContain('content 5 chunk 0');
      expect(JSON.stringify(outcome)).not.toContain('content 5 chunk 1');
      // Other bundles still reduce both chunks.
      expect(JSON.stringify(outcome)).toContain('content 4 chunk 1');
    });
  });
});
