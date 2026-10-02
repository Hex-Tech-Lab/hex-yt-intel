/**
 * R3b 2.5b: v2 cell persist, end to end across the signing boundary.
 *
 * The worker's real PersistService signs the body; that exact body is posted
 * into the real persist route with the real verifyContentSig (only storage is
 * mocked). This is the proof that the worker and route canonicals agree, both
 * for a v2 cell (which adds `cell`) and for a K=1 body (which must not).
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET = 'test-stream-hmac-secret';
process.env.STREAM_HMAC_SECRET = SECRET;

// PersistService captures `fetch` at module load, so the capturing stub must
// be installed before the imports below (vi.hoisted runs first).
const captured = vi.hoisted(() => {
  const state: { lastBody: Record<string, unknown> | null } = { lastBody: null };
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    state.lastBody = JSON.parse(String(init?.body));
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  return state;
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn(), flush: vi.fn().mockResolvedValue(true) }));

const adapterInstance = vi.hoisted(() => ({
  findAnalysisForPersist: vi.fn(),
  persistAnalysisChunk: vi.fn(),
  findAnalysisChunks: vi.fn(),
  updateAnalysisResult: vi.fn(),
  updateValidationReport: vi.fn().mockResolvedValue(null),
  markChunkFailed: vi.fn().mockResolvedValue(true),
  findJevPlan: vi.fn(),
  findAnalysisCells: vi.fn(),
}));
vi.mock('@/lib/adapters', () => ({ SupabasePersistenceAdapter: vi.fn(function mockAdapterClass() { return adapterInstance; }) }));
vi.mock('@/lib/adapters/SupabaseTranscriptAdapter', () => ({
  SupabaseTranscriptAdapter: { upsertTranscript: vi.fn().mockResolvedValue(null), upsertChapters: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/adapters/PostgresBillingAdapter', () => ({
  PostgresBillingAdapter: vi.fn(function mockBillingAdapterClass() { return { consumeQuota: vi.fn().mockResolvedValue(null) }; }),
}));
vi.mock('@/lib/services/traffic', () => ({ getUserTier: vi.fn().mockResolvedValue('free') }));
vi.mock('@/lib/qstash-client', () => ({
  publishValidationTask: vi.fn().mockResolvedValue(null),
  publishDigestTask: vi.fn().mockResolvedValue(null),
  publishHighlightsTask: vi.fn().mockResolvedValue(null),
  publishEmbeddingTask: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/services/cache', () => ({ setAnalysisCache: vi.fn().mockResolvedValue(null), generateCacheKey: vi.fn().mockReturnValue('cache-key') }));

import { POST } from '@/app/api/analyses/persist/route';
import { PersistService } from '../../../worker/src/services/PersistService';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'abcdefghijk';
const SHA = 'a'.repeat(64);
// K=2 over 4 grounded bundles + 1 projective: 2*4 + 1 = 9 cells.
const PLAN = {
  K: 2,
  streamCount: 9,
  cells: [
    ...[0, 1].flatMap((jevChunkIndex) => [1, 2, 3, 4].map((chunkIndex) => ({ jevChunkIndex, chunkIndex, startWord: 0, endWord: 10, sha256: SHA }))),
    { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: SHA },
  ],
};
const CHUNK_TEXT = JSON.stringify({
  schemaVersion: '2.0',
  dimensions: [1, 2, 3].map((number) => ({ number, name: `D${number}`, content: `content for dim ${number}` })),
});


beforeEach(() => {
  vi.clearAllMocks();
  captured.lastBody = null;
  adapterInstance.findAnalysisForPersist.mockResolvedValue({ id: ANALYSIS_ID, video_id: VIDEO_ID, user_id: 'u1', status: 'processing', transcriptHash: null });
  adapterInstance.persistAnalysisChunk.mockResolvedValue(undefined);
  adapterInstance.findAnalysisChunks.mockResolvedValue([]);
  adapterInstance.findJevPlan.mockResolvedValue(PLAN);
  // Only the cell under test exists: the K>1 set is incomplete.
  adapterInstance.findAnalysisCells.mockResolvedValue([
    { jev_chunk_index: 1, chunk_index: 2, dimensions_covered: [1, 2, 3], payload: JSON.parse(CHUNK_TEXT), status: 'completed', updated_at: new Date().toISOString() },
  ]);
});

async function workerSignedBody(extra: { chunkIndex: number; totalChunks: number; jevChunkIndex?: number }) {
  await new PersistService().persist({
    analysisId: ANALYSIS_ID,
    videoId: VIDEO_ID,
    finalText: CHUNK_TEXT,
    modelUsed: 'test-model',
    status: 'completed',
    activeSecret: SECRET,
    appUrl: 'https://example.com',
    validate12D: () => true,
    ...extra,
  });
  if (!captured.lastBody) throw new Error('PersistService did not post');
  return captured.lastBody;
}

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('https://example.com/api/analyses/persist', { method: 'POST', body: JSON.stringify(body) }));

describe('persist route — v2 cell (R3b 2.5b)', () => {
  it('accepts a worker-signed v2 cell, stores it under (jevChunkIndex, chunkIndex), and does not finalize an incomplete set', async () => {
    const body = await workerSignedBody({ chunkIndex: 2, totalChunks: 9, jevChunkIndex: 1 });
    expect(body.jevChunkIndex).toBe(1);
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(expect.objectContaining({ chunkIndex: 2, jevChunkIndex: 1 }));
    // 2.5c: a v2 cell reads every cell (never the jev-0-only bundle rows);
    // with only this one cell present the set is incomplete, so no finalize.
    expect(adapterInstance.findAnalysisChunks).not.toHaveBeenCalled();
    expect(adapterInstance.findAnalysisCells).toHaveBeenCalled();
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('rejects a replayed v2 body whose cell was changed after signing (401)', async () => {
    const body = await workerSignedBody({ chunkIndex: 2, totalChunks: 9, jevChunkIndex: 1 });
    expect((await post({ ...body, jevChunkIndex: 0 })).status).toBe(401);
    expect((await post({ ...body, chunkIndex: 3 })).status).toBe(401);
    expect(adapterInstance.persistAnalysisChunk).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed cell the plan does not expect (400)', async () => {
    const notInPlan = await workerSignedBody({ chunkIndex: 5, totalChunks: 9, jevChunkIndex: 1 });
    expect((await post(notInPlan)).status).toBe(400);
    const wrongTotal = await workerSignedBody({ chunkIndex: 2, totalChunks: 5, jevChunkIndex: 1 });
    expect((await post(wrongTotal)).status).toBe(400);
    adapterInstance.findJevPlan.mockResolvedValue(null);
    const noPlan = await workerSignedBody({ chunkIndex: 2, totalChunks: 9, jevChunkIndex: 1 });
    expect((await post(noPlan)).status).toBe(400);
    expect(adapterInstance.persistAnalysisChunk).not.toHaveBeenCalled();
  });

  it('a K=1 body signs without a cell, never reads the plan, and runs the normal completeness check', async () => {
    const body = await workerSignedBody({ chunkIndex: 2, totalChunks: 5 });
    expect(body).not.toHaveProperty('jevChunkIndex');
    expect((await post(body)).status).toBe(200);
    expect(adapterInstance.findJevPlan).not.toHaveBeenCalled();
    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(expect.objectContaining({ chunkIndex: 2, jevChunkIndex: undefined }));
    expect(adapterInstance.findAnalysisChunks).toHaveBeenCalled();
  });
});
