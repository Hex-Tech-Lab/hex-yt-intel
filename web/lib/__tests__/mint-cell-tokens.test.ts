/**
 * R3b 2.3.5c: MintCellTokensUseCase. Every signed field comes from the stored
 * plan; the proof is a ROUND TRIP through the worker's real verifyStreamToken
 * with the web signer and the same secret.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mintCellTokens, type SignV2Params } from '@/lib/usecases/MintCellTokensUseCase';
import { verifyStreamToken } from '../../../worker/src/routes/analysis';

const SECRET = 'test-stream-hmac-secret';
const ENV = { STREAM_HMAC_SECRET: SECRET, APP_URL: 'https://example.com' } as never;
const BUNDLES = [[1, 2, 3], [4, 5], [6, 7], [8, 10], [9, 11]];
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MODELS = ['model-b', 'model-a'];

// K=3 over 4 grounded bundles + 1 projective: 3*4 + 1 = 13 cells.
const PLAN = {
  K: 3,
  streamCount: 13,
  truncatedFallback: false,
  estimateCents: 12,
  cells: [
    ...[0, 1, 2].flatMap((k) => [1, 2, 3, 4].map((chunkIndex) => ({
      jevChunkIndex: k, chunkIndex, startWord: k * 100, endWord: (k + 1) * 100, sha256: String(k + 1).repeat(64),
    }))),
    { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: EMPTY },
  ],
};

let sign: (params: SignV2Params) => Promise<{ sig: string; exp: number }>;
beforeAll(async () => {
  process.env.STREAM_HMAC_SECRET = SECRET;
  ({ signStreamTokenV2: sign } = await import('@/lib/stream-token'));
});

const base = { analysisId: 'an', videoId: 'vid', models: MODELS, bundleList: BUNDLES, storedPlan: PLAN };

function verifyOpts(token: { streamCount: number; jevChunkIndex: number; jevChunkCount: number; chunkIndex: number; bundleList: number[][]; sliceSha256: string; startWord: number; endWord: number }) {
  return {
    tokenVersion: 2 as const,
    streamCount: token.streamCount,
    jevChunkIndex: token.jevChunkIndex,
    jevChunkCount: token.jevChunkCount,
    bundleList: token.bundleList,
    chunkIndex: token.chunkIndex,
    sliceSha256: token.sliceSha256,
    startWord: token.startWord,
    endWord: token.endWord,
    // The browser sends the cell's signed bundle as its dimensions.
    dimensions: token.bundleList[token.chunkIndex - 1],
  };
}

describe('mintCellTokens (R3b 2.3.5c)', () => {
  it('mints one token per requested cell (grounded + projective) and each verifies in the worker', async () => {
    const cells = [{ jevChunkIndex: 1, chunkIndex: 2 }, { jevChunkIndex: 2, chunkIndex: 4 }, { jevChunkIndex: 0, chunkIndex: 5 }];
    const outcome = await mintCellTokens({ ...base, cells }, sign);
    expect(outcome.type).toBe('ok');
    if (outcome.type !== 'ok') return;
    expect(outcome.tokens).toHaveLength(3);
    for (const token of outcome.tokens) {
      const res = await verifyStreamToken('vid', 'an', token.exp, token.sig, MODELS, ENV, verifyOpts(token));
      expect(res.isValid).toBe(true);
    }
    const projective = outcome.tokens[2]!;
    expect([projective.startWord, projective.endWord, projective.sliceSha256]).toEqual([0, 0, EMPTY]);
  });

  it('takes slice fields from the stored plan, so a token presented with another cell\'s fields fails', async () => {
    const outcome = await mintCellTokens({ ...base, cells: [{ jevChunkIndex: 0, chunkIndex: 1 }] }, sign);
    if (outcome.type !== 'ok') throw new Error(outcome.type);
    const token = outcome.tokens[0]!;
    expect([token.startWord, token.endWord, token.sliceSha256]).toEqual([0, 100, '1'.repeat(64)]);
    const forged = { ...token, jevChunkIndex: 1, startWord: 100, endWord: 200, sliceSha256: '2'.repeat(64) };
    const res = await verifyStreamToken('vid', 'an', token.exp, token.sig, MODELS, ENV, verifyOpts(forged));
    expect(res.isValid).toBe(false);
  });

  it('rejects unknown and duplicate cells, naming the offending cell', async () => {
    expect(await mintCellTokens({ ...base, cells: [{ jevChunkIndex: 5, chunkIndex: 1 }] }, sign))
      .toEqual({ type: 'unknown_cell', cell: { jevChunkIndex: 5, chunkIndex: 1 } });
    expect(await mintCellTokens({ ...base, cells: [{ jevChunkIndex: 0, chunkIndex: 1 }, { jevChunkIndex: 0, chunkIndex: 1 }] }, sign))
      .toEqual({ type: 'duplicate_cell', cell: { jevChunkIndex: 0, chunkIndex: 1 } });
  });

  it('refuses to mint for a missing, malformed, K=1 or truncated-fallback plan', async () => {
    const cells = [{ jevChunkIndex: 0, chunkIndex: 1 }];
    expect((await mintCellTokens({ ...base, storedPlan: null, cells }, sign)).type).toBe('no_plan');
    expect((await mintCellTokens({ ...base, storedPlan: { K: 'x' }, cells }, sign)).type).toBe('invalid_plan');
    expect((await mintCellTokens({ ...base, storedPlan: { ...PLAN, K: 1, streamCount: 5 }, cells }, sign)).type).toBe('plan_k1');
    expect((await mintCellTokens({ ...base, storedPlan: { ...PLAN, truncatedFallback: true }, cells }, sign)).type).toBe('plan_truncated');
  });
});
