/**
 * Route-level tests for the payload-less chunk persist + set-closed finalize
 * fix (RCA 2026-09-13, live video gKgWYFOhZx0, analysis cc71afb9).
 *
 * THE INCIDENT: bundle 1 ([1,10]) produced text but no parseable structured
 * payload → PersistService's markdown-only fallback posted chunkIndex=1 with
 * payload:null. The chunk-path guard (`chunkIndex && validPayload &&
 * 'dimensions' in payload`) rejected it, so the request fell through to the
 * NON-CHUNK finalize path, which stitched only the chunks that existed at
 * that instant (2 of 5) and finalized the row 'partial' at 6/11 dimensions —
 * racing the still-streaming bundles. The chunks landing afterward could
 * never re-finalize the row (isFullyReceived requires all 5 indices; the
 * payload-less index can never produce a completed chunk), leaving the row
 * permanently truncated while 10/11 dimensions sat complete in
 * analysis_chunks.
 *
 * The fix: (1) a payload-less non-interrupted chunk persist records its
 * chunk row as 'failed' and never finalizes the parent from it; (2) once
 * every chunk index is terminal (completed OR failed), the persist that
 * observes the closed set finalizes immediately with the partial stitch of
 * the completed chunks. PersistService's own HTTP retry re-POSTs the same
 * body per attempt (so a given bundle can produce at most one terminal
 * persist), and the adapter's monotonic guard database-enforces that a
 * 'failed' write can never clobber a completed row. Interrupted + null
 * payload keeps its existing non-chunk interrupted terminal write.
 */
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
}));

vi.mock('@/lib/services/cache', () => ({
  setAnalysisCache: vi.fn().mockResolvedValue(null),
  generateCacheKey: vi.fn().mockReturnValue('cache-key'),
}));

import { POST } from '@/app/api/analyses/persist/route';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'gKgWYFOhZx0';

function dim(dimNumber: number): { number: number; name: string; content: string } {
  return { number: dimNumber, name: `Dimension ${dimNumber}`, content: `content for dim ${dimNumber}` };
}

// The incident's real chunk coverage: chunk 1 (dims 1,10) produced NO
// parseable payload; chunks 2-5 cover dims 8, 2/4/6, 5/7/10, 3/9/11.
const CHUNK_PAYLOADS: Record<number, unknown> = {
  2: { schemaVersion: '2.0', dimensions: [dim(8)] },
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

function chunkRows(specs: Array<{ index: number; status: string }>) {
  return specs.map((s) => ({
    chunk_index: s.index,
    dimensions_covered: [],
    payload: s.status === 'completed' ? CHUNK_PAYLOADS[s.index] ?? {} : {},
    status: s.status,
    updated_at: new Date().toISOString(),
    tokens_used: 1000,
    cost_usd: 0.01,
  }));
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

describe('POST /api/analyses/persist — payload-less chunk + set-closed finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
  });

  it('a payload-less chunk persist records the chunk as failed and does NOT finalize the parent row', async () => {
    // Only this bundle's own (failed) row exists — the others are still streaming.
    adapterInstance.findAnalysisChunks.mockResolvedValue(chunkRows([{ index: 1, status: 'failed' }]));

    const res = await POST(
      post({ payload: null, chunkIndex: 1, totalChunks: 5, status: 'completed', model: 'm', tokensUsed: 500, costUsd: 0.02 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('chunk_saved');
    expect(body.chunkIndex).toBe(1);

    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 1, status: 'failed', dimensionsCovered: [] })
    );
    // The regression: the payload-less request must never reach the
    // non-chunk finalize path and write the parent row.
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('the persist that observes a fully settled set finalizes with the partial stitch of completed chunks', async () => {
    // Chunk 5's persist lands last; the set is now terminal (1 failed, 2-5 completed).
    adapterInstance.findAnalysisChunks.mockResolvedValue(
      chunkRows([
        { index: 1, status: 'failed' },
        { index: 2, status: 'completed' },
        { index: 3, status: 'completed' },
        { index: 4, status: 'completed' },
        { index: 5, status: 'completed' },
      ])
    );

    const res = await POST(
      post({ payload: CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'Claude Haiku 4.5' })
    );
    expect(res.status).toBe(200);

    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.payload.dimensions.map((d: { number: number }) => d.number).sort((leftDim: number, rightDim: number) => leftDim - rightDim)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(call.validationReport.validation_status).toBe('partial');
    expect(call.validationReport.billing_status).toBe('failed');
    const done = call.validationReport.dimension_status.filter((d: { status: string }) => d.status === 'done');
    const timedOut = call.validationReport.dimension_status.filter((d: { status: string }) => d.status === 'timeout');
    expect(done.map((d: { dimension: number }) => d.dimension).sort((leftDim: number, rightDim: number) => leftDim - rightDim)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(timedOut.map((d: { dimension: number }) => d.dimension)).toEqual([1]);
    // Partial finalize must NOT trip the completed-only side effects.
    const { publishDigestTask, publishHighlightsTask, publishValidationTask } = await import('@/lib/qstash-client');
    expect(publishDigestTask).not.toHaveBeenCalled();
    expect(publishHighlightsTask).not.toHaveBeenCalled();
    expect(publishValidationTask).not.toHaveBeenCalled();
  });

  it('a partially settled set (missing index, no row at all) does not finalize', async () => {
    // Chunks 2,3 completed; chunk 1 failed; 4 and 5 have no rows yet.
    adapterInstance.findAnalysisChunks.mockResolvedValue(
      chunkRows([
        { index: 1, status: 'failed' },
        { index: 2, status: 'completed' },
        { index: 3, status: 'completed' },
      ])
    );

    const res = await POST(
      post({ payload: CHUNK_PAYLOADS[3], chunkIndex: 3, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.persistAnalysisChunk).toHaveBeenCalledWith(expect.objectContaining({ chunkIndex: 3, status: 'completed' }));
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('interrupted + null payload keeps the existing non-chunk interrupted terminal write (no failed-chunk reroute)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue(chunkRows([{ index: 3, status: 'completed' }]));

    const res = await POST(
      post({ payload: null, chunkIndex: 1, totalChunks: 5, status: 'interrupted', model: 'm' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('interrupted');

    // Existing behavior: interrupted persists never touch analysis_chunks.
    expect(adapterInstance.persistAnalysisChunk).not.toHaveBeenCalled();
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.validationReport.validation_status).toBe('interrupted');
  });

  it('a fully received completed set still finalizes exactly as before (unchanged happy path)', async () => {
    const rows = chunkRows([
      { index: 1, status: 'completed' },
      { index: 2, status: 'completed' },
      { index: 3, status: 'completed' },
      { index: 4, status: 'completed' },
      { index: 5, status: 'completed' },
    ]);
    rows[0].payload = { schemaVersion: '2.0', dimensions: [dim(1), dim(10)] };
    // The canonical bundle layout for chunk 4 is [5,7] — CHUNK_PAYLOADS[4]
    // models the INCIDENT's real row (which captured a spurious dim 10 from
    // the model's output), which would duplicate dim 10 in a full 5-chunk
    // stitch and muddy the 11-dimension assertion below.
    rows[3].payload = { schemaVersion: '2.0', dimensions: [dim(5), dim(7)] };
    adapterInstance.findAnalysisChunks.mockResolvedValue(rows);

    const res = await POST(
      post({ payload: CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm', valid: true })
    );
    expect(res.status).toBe(200);

    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(call.payload.dimensions).toHaveLength(11);
    expect(call.validationReport.validation_status).toBe('done');
    expect(call.validationReport.billing_status).toBe('completed');
    // Completed billing gate side effects fire (unchanged behavior).
    const { publishDigestTask, publishHighlightsTask } = await import('@/lib/qstash-client');
    expect(publishDigestTask).toHaveBeenCalledTimes(1);
    expect(publishHighlightsTask).toHaveBeenCalledTimes(1);
  });
});
