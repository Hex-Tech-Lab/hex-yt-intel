import { describe, it, expect, vi } from 'vitest';
import { ProjectiveContextUseCase, type PersistedChunk } from '../ProjectiveContextUseCase';

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

function build(opts: { owns?: boolean; chunks?: PersistedChunk[] } = {}) {
  const sign = vi.fn().mockResolvedValue({ sig: 'SIG', exp: 123 });
  const useCase = new ProjectiveContextUseCase({
    ownsAnalysis: vi.fn().mockResolvedValue(opts.owns ?? true),
    findChunks: vi.fn().mockResolvedValue(opts.chunks ?? groundedChunks()),
    resolveSettings: vi.fn().mockResolvedValue({ streamBundles: MAP, priorPayloadMaxBytes: 65536, retryAfterMs: 1500, maxWaitMs: 20000 }),
    sign,
  });
  return { useCase, sign };
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
});
