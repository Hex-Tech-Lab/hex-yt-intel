/**
 * Route-level tests for the P0 finding from the PR #312 post-merge review:
 * the parent-row finalize must be an atomic, idempotent
 * 'processing' → terminal transition, not a blind write.
 *
 * Two concurrent requests can reach finalize for the same analysis (a real
 * scenario under retry). The finalize now passes
 * `guardBillingStatus: 'processing'` into updateAnalysisResult — the same
 * CAS-guard shape analysis-reaper.ts's tryRequeuePartial and
 * dimension-remediation.ts's remediated finalize already use, enforced by
 * the update_analysis_result_atomic RPC's conditional UPDATE — and when the
 * write reports `updated: false` (another writer already moved the row off
 * 'processing'), the request returns early with NO cache writes, NO billing
 * transitions, and NO QStash publishes.
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
  updateValidationReport: vi.fn().mockResolvedValue(null),
  markChunkFailed: vi.fn(),
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

function dim(dimNumber: number): { number: number; name: string; content: string } {
  return { number: dimNumber, name: `Dimension ${dimNumber}`, content: `content for dim ${dimNumber}` };
}

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

function fullCompletedChunkRows() {
  const payloads: Record<number, unknown> = {
    1: { schemaVersion: '2.0', dimensions: [dim(1), dim(10)] },
    2: { schemaVersion: '2.0', dimensions: [dim(2), dim(4), dim(6)] },
    3: { schemaVersion: '2.0', dimensions: [dim(3), dim(9), dim(11)] },
    4: { schemaVersion: '2.0', dimensions: [dim(5), dim(7)] },
    5: { schemaVersion: '2.0', dimensions: [dim(8)] },
  };
  return Object.entries(payloads).map(([index, payload]) => ({
    chunk_index: Number(index),
    dimensions_covered: [],
    payload,
    status: 'completed',
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

const finalizePost = (): NextRequest =>
  post({ payload: { schemaVersion: '2.0', dimensions: [dim(8)] }, chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm', valid: true });

describe('P0 — parent finalize is an atomic processing→terminal CAS transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(null);
    adapterInstance.markChunkFailed.mockResolvedValue(true);
    adapterInstance.findAnalysisChunks.mockResolvedValue(fullCompletedChunkRows());
  });

  it('every parent write passes guardBillingStatus "processing" (chunk-path finalize)', async () => {
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });

    const res = await POST(finalizePost());
    expect(res.status).toBe(200);

    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    expect(adapterInstance.updateAnalysisResult.mock.calls[0][0].guardBillingStatus).toBe('processing');
  });

  it('two concurrent finalizes produce exactly one parent write and one set of side effects (first-writer CAS wins)', async () => {
    // Realistic CAS semantics: the FIRST guarded write transitions the row
    // off 'processing'; every subsequent write's guard fails (updated:false).
    let writeAttempts = 0;
    adapterInstance.updateAnalysisResult.mockImplementation(() => {
      writeAttempts += 1;
      return Promise.resolve({ updated: writeAttempts === 1 });
    });

    const [resA, resB] = await Promise.all([POST(finalizePost()), POST(finalizePost())]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Both requests attempted the guarded parent write; exactly one won.
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(2);
    for (const call of adapterInstance.updateAnalysisResult.mock.calls) {
      expect(call[0].guardBillingStatus).toBe('processing');
    }

    // Exactly ONE set of side effects — the loser returned before any of them.
    const { publishDigestTask, publishHighlightsTask, publishValidationTask } = await import('@/lib/qstash-client');
    const { setAnalysisCache } = await import('@/lib/services/cache');
    expect(publishDigestTask).toHaveBeenCalledTimes(1);
    expect(publishHighlightsTask).toHaveBeenCalledTimes(1);
    expect(publishValidationTask).toHaveBeenCalledTimes(1);
    expect(setAnalysisCache).toHaveBeenCalledTimes(1);
  });

  it('a CAS loss on the non-chunk finalize returns early with no side effects (no stale interrupted/partial mutation)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue([]);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: false });

    const res = await POST(
      post({ markdown: 'final markdown', model: 'm', valid: true, status: 'completed' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, analysisId: ANALYSIS_ID });

    const { publishDigestTask, publishHighlightsTask, publishValidationTask } = await import('@/lib/qstash-client');
    const { setAnalysisCache } = await import('@/lib/services/cache');
    expect(publishDigestTask).not.toHaveBeenCalled();
    expect(publishHighlightsTask).not.toHaveBeenCalled();
    expect(publishValidationTask).not.toHaveBeenCalled();
    expect(setAnalysisCache).not.toHaveBeenCalled();
  });

  it('a stale interrupted persist cannot downgrade an already-terminal row (CAS rejects it, response still interrupted)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue([]);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: false });

    const res = await POST(
      post({ payload: null, chunkIndex: 1, totalChunks: 5, status: 'interrupted', model: 'm' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('interrupted');

    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    expect(adapterInstance.updateAnalysisResult.mock.calls[0][0].guardBillingStatus).toBe('processing');
    // The stale write was rejected — nothing else fired.
    expect(adapterInstance.persistAnalysisChunk).not.toHaveBeenCalled();
  });
});

/**
 * RCA (2026-09-24, vector-coverage): embedding jobs previously rode the
 * transcript_available-gated validation-webhook chain, so completed rows
 * finalized outside that chain (or metadata-only rows, or rows whose
 * validate webhook dropped mid-chain) never got vectors — 68/119 completed
 * rows were missing at RCA time. The finalize now publishes the embed task
 * DIRECTLY on every completed path, decoupled from transcript availability.
 */
describe('finalize publishes the embedding task directly on every completed path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(null);
    adapterInstance.markChunkFailed.mockResolvedValue(true);
    adapterInstance.findAnalysisChunks.mockResolvedValue(fullCompletedChunkRows());
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
  });

  it('chunk-path finalize publishes the embed task (idempotent upsert happens in the webhook)', async () => {
    const res = await POST(finalizePost());
    expect(res.status).toBe(200);

    const { publishEmbeddingTask } = await import('@/lib/qstash-client');
    expect(publishEmbeddingTask).toHaveBeenCalledTimes(1);
    expect(publishEmbeddingTask).toHaveBeenCalledWith({
      analysisId: ANALYSIS_ID,
      markdown: expect.any(String),
      userId: 'user-1',
    });
  });

  it('non-chunk finalize publishes the embed task even WITHOUT a transcript (metadata-only rows embed too)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue([]);
    adapterInstance.findAnalysisForPersist.mockResolvedValue({
      ...ROW,
      validationReport: {
        ...ROW.validationReport,
        transcript_available: false,
        analysis_type: 'metadata-only',
      },
    });

    const res = await POST(
      post({ markdown: 'final markdown', model: 'm', valid: true, status: 'completed' })
    );
    expect(res.status).toBe(200);

    const { publishEmbeddingTask, publishValidationTask } = await import('@/lib/qstash-client');
    // Embed fires — this is the fix. Validation publish stays
    // transcript-gated (unchanged behavior).
    expect(publishEmbeddingTask).toHaveBeenCalledTimes(1);
    expect(publishValidationTask).not.toHaveBeenCalled();
  });

  it('CAS loss still publishes zero embed tasks (side effects only fire for the CAS winner)', async () => {
    adapterInstance.findAnalysisChunks.mockResolvedValue([]);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: false });

    await POST(
      post({ markdown: 'final markdown', model: 'm', valid: true, status: 'completed' })
    );

    const { publishEmbeddingTask } = await import('@/lib/qstash-client');
    expect(publishEmbeddingTask).not.toHaveBeenCalled();
  });

  it('an embed publish failure raises the side-effect-failed flag (side_effects_pending claim left set, response still 200)', async () => {
    const { publishEmbeddingTask } = await import('@/lib/qstash-client');
    (publishEmbeddingTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('qstash publish failed'));

    const res = await POST(
      post({ markdown: 'final markdown', model: 'm', valid: true, status: 'completed' })
    );
    expect(res.status).toBe(200);

    const sentry = await import('@sentry/nextjs');
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('side effects partially failed'),
      expect.objectContaining({ level: 'warning' })
    );
    // The side_effects_pending claim-clearing write must NOT have run — the
    // claim stays set so the outbox reconciliation picks it up.
    expect(adapterInstance.updateValidationReport).not.toHaveBeenCalled();
  });
});
