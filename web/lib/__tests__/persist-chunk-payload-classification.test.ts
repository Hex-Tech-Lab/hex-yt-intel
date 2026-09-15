/**
 * Route-level tests for the PR #312 post-merge review findings in
 * web/app/api/analyses/persist/route.ts:
 *
 * P1b — three-way payload classification for chunk requests. A malformed
 * (truthy but schema-invalid) chunk payload used to 400 out of the route;
 * the worker's PersistService treats every non-OK persist as retryable (3
 * attempts, then gives up) and that bundle's chunk row was never written,
 * so the completeness set could never close and the parent row sat
 * 'processing' until the reaper's grace window — the same freeze PR #312
 * fixed for payload:null, via a different malformed shape. All three
 * malformed shapes now persist a terminal 'failed' chunk row through the
 * chunk workflow and never reach the non-chunk finalize path.
 *
 * P1a — a nominally-'completed' chunk row whose payload has no usable
 * dimensions shape is reclassified 'failed' (same accounting as the
 * payload-less failed rows) before the settled-partial stitch, instead of
 * silently vanishing from it.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyContentSig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const adapterInstance = vi.hoisted(() => ({
  findAnalysisForPersist: vi.fn(),
  persistAnalysisChunk: vi.fn(),
  findAnalysisChunks: vi.fn(),
  updateAnalysisResult: vi.fn(),
  markChunkFailed: vi.fn(),
}));

vi.mock('@/lib/adapters', () => ({
  SupabasePersistenceAdapter: class {
    constructor() {
      return adapterInstance;
    }
  },
}));

vi.mock('@/lib/adapters/SupabaseTranscriptAdapter', () => ({
  SupabaseTranscriptAdapter: {
    upsertTranscript: vi.fn().mockResolvedValue(undefined),
    upsertChapters: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/adapters/PostgresBillingAdapter', () => ({
  PostgresBillingAdapter: class {
    consumeQuota = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/lib/services/traffic', () => ({
  getUserTier: vi.fn().mockResolvedValue('free'),
}));

vi.mock('@/lib/qstash-client', () => ({
  publishValidationTask: vi.fn().mockResolvedValue(undefined),
  publishDigestTask: vi.fn().mockResolvedValue(undefined),
  publishHighlightsTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/cache', () => ({
  setAnalysisCache: vi.fn().mockResolvedValue(undefined),
  generateCacheKey: vi.fn().mockReturnValue('cache-key'),
}));

import { POST } from '@/app/api/analyses/persist/route';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'gKgWYFOhZx0';

function dim(dimNumber: number): { number: number; name: string; content: string } {
  return { number: dimNumber, name: `Dimension ${dimNumber}`, content: `content for dim ${dimNumber}` };
}

const CHUNK_PAYLOADS: Record<number, unknown> = {
  3: { schemaVersion: '2.0', dimensions: [dim(2), dim(4), dim(6)] },
  4: { schemaVersion: '2.0', dimensions: [dim(5), dim(7), dim(10)] },
  5: { schemaVersion: '2.0', dimensions: [dim(3), dim(9), dim(11)] },
};

const ROW = {
  id: ANALYSIS_ID,
  title: '7 Best Influencer Marketing Platforms',
  channelTitle: 'Business Solution',
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

function chunkRow(index: number, status: string, payload: unknown) {
  return {
    chunk_index: index,
    dimensions_covered: [],
    payload,
    status,
    updated_at: new Date().toISOString(),
    tokens_used: 1000,
    cost_usd: 0.01,
  };
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/analyses/persist', {
    method: 'POST',
    body: JSON.stringify({
      analysisId: ANALYSIS_ID,
      videoId: VIDEO_ID,
      markdown: 'partial markdown',
      contentSig: 'sig',
      ...body,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('P1b — malformed chunk payloads persist as terminal failed chunk rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.markChunkFailed.mockResolvedValue(true);
    // Only this bundle's own failed row — the others are still streaming, so
    // no finalize can fire either way.
    adapterInstance.findAnalysisChunks.mockResolvedValue([chunkRow(1, 'failed', {})]);
  });

  it.each([
    ['null payload', null],
    ['empty-object payload', {}],
    ['malformed-object payload', { foo: 'bar' }],
  ])('%s routes through the chunk workflow as a failed chunk row, never the non-chunk finalize', async (_name, chunkPayload) => {
    const res = await POST(
      post({ payload: chunkPayload, chunkIndex: 1, totalChunks: 5, status: 'completed', model: 'm', tokensUsed: 500, costUsd: 0.02 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('chunk_saved');
    expect(body.chunkIndex).toBe(1);

    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 1, status: 'failed' })
    );
    // The regression: none of the three shapes may reach the non-chunk
    // finalize path and write the parent row.
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('interrupted + malformed payload keeps the existing non-chunk interrupted terminal write (same as payload-less)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue([chunkRow(3, 'completed', CHUNK_PAYLOADS[3])]);

    const res = await POST(
      post({ payload: { foo: 'bar' }, chunkIndex: 1, totalChunks: 5, status: 'interrupted', model: 'm' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('interrupted');

    // Interrupted persists never touch analysis_chunks (unchanged behavior,
    // deliberately: rerouting would delay the terminal write to the reaper's
    // grace window).
    expect(adapterInstance.persistAnalysisChunk).not.toHaveBeenCalled();
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.validationReport.validation_status).toBe('interrupted');
    // P0: even this interrupted terminal write is a CAS transition.
    expect(call.guardBillingStatus).toBe('processing');
  });
});

describe('P1a — completed-but-malformed chunks are reclassified before the settled stitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.markChunkFailed.mockResolvedValue(true);
  });

  it('a nominally-completed chunk with a malformed payload is reclassified to failed and excluded from the stitch, not silently dropped', async () => {
    // Chunk 1 failed for real; chunk 2 is nominally 'completed' but its
    // payload has no usable dimensions shape (legacy row shape). Chunk 5's
    // persist lands last and closes the settled set.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'failed', {}),
      chunkRow(2, 'completed', {}),
      chunkRow(3, 'completed', CHUNK_PAYLOADS[3]),
      chunkRow(4, 'completed', CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'Claude Haiku 4.5' })
    );
    expect(res.status).toBe(200);

    // The malformed completed row is reclassified (same accounting as the
    // payload-less failed rows) and observable.
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledTimes(1);
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledWith({ analysisId: ANALYSIS_ID, chunkIndex: 2 });
    const { captureMessage } = await import('@sentry/nextjs');
    expect(captureMessage).toHaveBeenCalledWith(
      'analyses/persist: completed chunk had malformed payload, reclassified to failed',
      expect.anything()
    );

    // The finalize still commits — with only the genuinely usable chunks —
    // and via the CAS-guarded parent write.
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.guardBillingStatus).toBe('processing');
    expect(call.payload.dimensions.map((d: { number: number }) => d.number).sort((leftDim: number, rightDim: number) => leftDim - rightDim))
      .toEqual([2, 3, 4, 5, 6, 7, 9, 10, 11]);
    expect(call.validationReport.validation_status).toBe('partial');
    expect(call.validationReport.billing_status).toBe('failed');
  });

  it('a fully-received set is unaffected by the settled-path reclassification (contract check still owns that path)', async () => {
    const rows = [
      chunkRow(1, 'completed', { schemaVersion: '2.0', dimensions: [dim(1), dim(10)] }),
      chunkRow(2, 'completed', CHUNK_PAYLOADS[3]),
      chunkRow(3, 'completed', CHUNK_PAYLOADS[5]),
      chunkRow(4, 'completed', CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', { schemaVersion: '2.0', dimensions: [dim(8)] }),
    ];
    adapterInstance.findAnalysisChunks.mockResolvedValue(rows);

    const res = await POST(
      post({ payload: { schemaVersion: '2.0', dimensions: [dim(8)] }, chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm', valid: true })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.markChunkFailed).not.toHaveBeenCalled();
    // All five chunks usable → done + billing completed, side effects fire.
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.validationReport.billing_status).toBe('completed');
    const { publishDigestTask, publishHighlightsTask } = await import('@/lib/qstash-client');
    expect(publishDigestTask).toHaveBeenCalledTimes(1);
    expect(publishHighlightsTask).toHaveBeenCalledTimes(1);
  });
});
