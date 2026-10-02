/** R3b 2.5c: K>1 finalize through the real persist route (signature + storage mocked). */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyContentSig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));

const adapterInstance = vi.hoisted(() => ({
  findAnalysisForPersist: vi.fn(),
  persistAnalysisChunk: vi.fn(),
  findAnalysisChunks: vi.fn(),
  updateAnalysisResult: vi.fn(),
  updateValidationReport: vi.fn().mockResolvedValue(null),
  markChunkFailed: vi.fn().mockResolvedValue(true),
  findJevPlan: vi.fn(),
  markJevPlanDegraded: vi.fn(),
  findAnalysisCells: vi.fn(),
}));

vi.mock('@/lib/adapters', () => ({
  SupabasePersistenceAdapter: vi.fn(function mockAdapterClass() { return adapterInstance; }),
}));

vi.mock('@/lib/adapters/SupabaseTranscriptAdapter', () => ({
  SupabaseTranscriptAdapter: {
    upsertTranscript: vi.fn().mockResolvedValue(null),
    upsertChapters: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@/lib/adapters/PostgresBillingAdapter', () => ({
  PostgresBillingAdapter: vi.fn(function mockBillingAdapterClass() { return { consumeQuota: vi.fn().mockResolvedValue(null) }; }),
}));

vi.mock('@/lib/services/traffic', () => ({
  getUserTier: vi.fn().mockResolvedValue('free'),
}));

vi.mock('@/lib/qstash-client', () => ({
  publishValidationTask: vi.fn().mockResolvedValue(null),
  publishDigestTask: vi.fn().mockResolvedValue(null),
  publishHighlightsTask: vi.fn().mockResolvedValue(null),
  publishEmbeddingTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/services/cache', () => ({
  setAnalysisCache: vi.fn().mockResolvedValue(null),
  generateCacheKey: vi.fn().mockReturnValue('cache-key'),
}));

import { POST } from '@/app/api/analyses/persist/route';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'gKgWYFOhZx0';
const SHA = 'a'.repeat(64);
const BUNDLES = [[1, 2, 3], [4, 5], [6, 7], [8, 10], [9, 11]];
// K=2: bundles 1-4 grounded over two chunks (words 0-100, 100-300), bundle 5 projective.
const PLAN = {
  K: 2,
  streamCount: 9,
  cells: [
    ...[0, 1].flatMap((jevChunkIndex) => [1, 2, 3, 4].map((chunkIndex) => ({
      jevChunkIndex, chunkIndex, startWord: jevChunkIndex * 100, endWord: jevChunkIndex === 0 ? 100 : 300, sha256: SHA,
    }))),
    { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: SHA },
  ],
};

const ROW = {
  id: ANALYSIS_ID,
  title: 't',
  channelTitle: 'c',
  userId: 'user-1',
  analysisPayload: null,
  validationReport: {
    status: 'processing',
    transcript_available: true,
    analysis_type: 'full',
    stale_after: new Date(Date.now() + 3600_000).toISOString(),
    metadata: { title: 't', videoId: VIDEO_ID, duration: 1393 },
    persona: { primary: { id: 'consultant' } },
    timezone: 'UTC',
  },
  transcriptHash: 'hash-1',
  transcript: 'transcript text',
};

const bundlePayload = (chunkIndex: number, jev: number) => ({
  schemaVersion: '2.0',
  dimensions: (BUNDLES[chunkIndex - 1] ?? []).map((number) => ({ number, name: `D${number}`, content: `d${number} from chunk ${jev}` })),
});

function cellRows(skip: Array<[number, number]> = [], failed: Array<[number, number]> = []) {
  return PLAN.cells
    .filter((cell) => !skip.some(([jev, chunk]) => cell.jevChunkIndex === jev && cell.chunkIndex === chunk))
    .map((cell) => {
      const isFailed = failed.some(([jev, chunk]) => cell.jevChunkIndex === jev && cell.chunkIndex === chunk);
      return {
        jev_chunk_index: cell.jevChunkIndex,
        chunk_index: cell.chunkIndex,
        dimensions_covered: BUNDLES[cell.chunkIndex - 1],
        payload: isFailed ? {} : bundlePayload(cell.chunkIndex, cell.jevChunkIndex),
        status: isFailed ? 'failed' : 'completed',
        updated_at: new Date().toISOString(),
        tokens_used: 100,
        cost_usd: 0.01,
      };
    });
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/analyses/persist', {
    method: 'POST',
    body: JSON.stringify({ analysisId: ANALYSIS_ID, videoId: VIDEO_ID, markdown: 'm', contentSig: 'sig', model: 'm', status: 'completed', ...body }),
    headers: { 'Content-Type': 'application/json' },
  });
}

const lastCell = { payload: bundlePayload(4, 1), chunkIndex: 4, jevChunkIndex: 1, totalChunks: 9 };

describe('POST /api/analyses/persist — K>1 reduce-then-stitch finalize (R3b 2.5c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.findJevPlan.mockResolvedValue(PLAN);
  });

  it('the last cell of a complete set finalizes once, with every bundle reduced across its chunks', async () => {
    adapterInstance.findAnalysisCells.mockResolvedValue(cellRows());
    const res = await POST(post(lastCell));
    expect(res.status).toBe(200);
    expect(adapterInstance.findAnalysisChunks).not.toHaveBeenCalled();
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    const dims = call.payload.dimensions as Array<{ number: number; content: string }>;
    expect(dims.map((dimension) => dimension.number).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(dims.find((dimension) => dimension.number === 4)?.content).toBe('d4 from chunk 0\n\nd4 from chunk 1');
    expect(dims.find((dimension) => dimension.number === 9)?.content).toBe('d9 from chunk 0');
    expect(call.validationReport.validation_status).toBe('done');
    expect(call.validationReport).not.toHaveProperty('jev_partial_dimensions');
  });

  it('a failed grounded cell: finalizes from the other chunk and records the partial dimensions', async () => {
    adapterInstance.findAnalysisCells.mockResolvedValue(cellRows([], [[1, 2]]));
    await POST(post(lastCell));
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.validationReport.jev_partial_dimensions).toEqual([4, 5]);
    expect((call.payload.dimensions as Array<{ number: number; content: string }>).find((dimension) => dimension.number === 4)?.content).toBe('d4 from chunk 0');
  });

  it('a cell still missing: no finalize', async () => {
    adapterInstance.findAnalysisCells.mockResolvedValue(cellRows([[1, 3]]));
    const res = await POST(post(lastCell));
    expect(res.status).toBe(200);
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('degradation hatch: a K>1 analysis whose browser fell back to K=1 finalizes from the 5 chunk-0 bundle rows', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue(
      [1, 2, 3, 4, 5].map((chunkIndex) => ({
        chunk_index: chunkIndex, dimensions_covered: BUNDLES[chunkIndex - 1], payload: bundlePayload(chunkIndex, 0),
        status: 'completed', updated_at: new Date().toISOString(), tokens_used: 100, cost_usd: 0.01,
      })),
    );
    const res = await POST(post({ payload: bundlePayload(5, 0), chunkIndex: 5, totalChunks: 5 }));
    expect(res.status).toBe(200);
    // The v1 chunk on a K>1 plan marks the plan degraded (projective context,
    // reaper and /stream-tokens then read it as K=1).
    expect(adapterInstance.markJevPlanDegraded).toHaveBeenCalledWith({ analysisId: expect.any(String), plan: { ...PLAN, degraded: true } });
    expect(adapterInstance.findAnalysisCells).not.toHaveBeenCalled();
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect((call.payload.dimensions as unknown[]).length).toBe(11);
    expect(call.validationReport).not.toHaveProperty('jev_partial_dimensions');
  });

  it('an interrupted v2 cell with no payload records only its own row; the parent is untouched', async () => {
    const res = await POST(post({ payload: null, chunkIndex: 2, jevChunkIndex: 1, totalChunks: 9, status: 'interrupted' }));
    expect(res.status).toBe(200);
    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(expect.objectContaining({ chunkIndex: 2, jevChunkIndex: 1, status: 'interrupted' }));
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });
});
