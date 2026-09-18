/**
 * Failure-injection tests for the durable side-effect claim (P1, PR #314
 * second review round, item 4 — see web/lib/services/side-effect-outbox.ts).
 *
 * Crash-window gap being tested: after the parent finalize's CAS write wins,
 * the route fires downstream side effects (cache write, QStash publishes).
 * A crash between the CAS write and those effects left them permanently
 * missing. The fix records `side_effects_pending: true` in the SAME atomic
 * write as the CAS transition and clears it best-effort only after every
 * tracked side effect succeeds; on any failure the claim stays set
 * (reconciliation-replayable, since digest/highlights are idempotent and the
 * cache write is an upsert).
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
  updateValidationReport: vi.fn(),
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
}));

const cacheMocks = vi.hoisted(() => ({ setAnalysisCache: vi.fn(), generateCacheKey: vi.fn().mockReturnValue('cache-key') }));

vi.mock('@/lib/services/cache', () => cacheMocks);

import { POST } from '@/app/api/analyses/persist/route';
import { hasPendingSideEffects, SIDE_EFFECTS_PENDING_REPORT_KEY } from '@/lib/services/side-effect-outbox';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'gKgWYFOhZx0';

const dimension = (dimNumber: number): { number: number; name: string; content: string } => ({
  number: dimNumber,
  name: `Dimension ${dimNumber}`,
  content: `content for dim ${dimNumber}`,
});

const VALID_CHUNK_PAYLOADS: Record<number, unknown> = {
  1: { schemaVersion: '2.0', dimensions: [dimension(1), dimension(2), dimension(3)] },
  2: { schemaVersion: '2.0', dimensions: [dimension(4), dimension(5), dimension(6)] },
  3: { schemaVersion: '2.0', dimensions: [dimension(7), dimension(8), dimension(9)] },
  4: { schemaVersion: '2.0', dimensions: [dimension(10), dimension(11)] },
  5: { schemaVersion: '2.0', dimensions: [dimension(10), dimension(11)] },
};

const ROW = {
  id: ANALYSIS_ID,
  title: 'Test Video',
  channelTitle: 'Test Channel',
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

const chunkRow = (index: number, status: string, payload: unknown) => ({
  chunk_index: index,
  dimensions_covered: [],
  payload,
  status,
  updated_at: new Date().toISOString(),
  tokens_used: 1000,
  cost_usd: 0.01,
});

const post = (body: Record<string, unknown>): NextRequest => {
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
};

describe('P1 item 4 — durable side-effect claim lifecycle (chunk path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    cacheMocks.setAnalysisCache.mockResolvedValue(null);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(null);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.updateValidationReport.mockResolvedValue(null);
    adapterInstance.markChunkFailed.mockResolvedValue(true);
  });

  it('NEGATIVE CONTROL (the gap): the CAS write and the side effects are NOT one atomic unit — the claim is recorded IN the CAS write so a crash between the two is detectable', async () => {
    // Full-success finalize. The claim must be present in the SAME
    // updateAnalysisResult payload that performs the 'processing' → terminal
    // transition — i.e. before any side effect fires — so a crash after the
    // write (but before the side effects) leaves the claim behind as the
    // durable record that reconciliation must replay. Previously the CAS
    // write carried no such claim at all: a crash in that window was
    // undetectable.
    // Settled set: chunks 1-3 completed, chunk 4 failed, and THIS request
    // persists chunk 5 (completed) — the last terminal row closes the set.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'completed', VALID_CHUNK_PAYLOADS[1]),
      chunkRow(2, 'completed', VALID_CHUNK_PAYLOADS[2]),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'failed', {}),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);

    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const finalizeCall = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    // The claim rides IN the atomic finalize write (billingStatus 'completed'
    // — all 11 dimensions covered — so this path fires side effects).
    expect(finalizeCall.validationReport[SIDE_EFFECTS_PENDING_REPORT_KEY]).toBe(true);
    expect(finalizeCall.validationReport.billing_status).toBe('completed');
  });

  it('failure injection: a failing cache write leaves the claim UNCLEARED (no clearing write)', async () => {
    cacheMocks.setAnalysisCache.mockRejectedValue(new Error('cache down'));
    // Settled set: chunks 1-3 completed, chunk 4 failed, and THIS request
    // persists chunk 5 (completed) — the last terminal row closes the set.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'completed', VALID_CHUNK_PAYLOADS[1]),
      chunkRow(2, 'completed', VALID_CHUNK_PAYLOADS[2]),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'failed', {}),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);

    // The tracked cache failure keeps the claim set — the clearing write
    // must NOT happen.
    expect(adapterInstance.updateValidationReport).not.toHaveBeenCalled();
  });

  it('all side effects succeed → the claim is cleared best-effort (side_effects_pending: false)', async () => {
    // Settled set: chunks 1-3 completed, chunk 4 failed, and THIS request
    // persists chunk 5 (completed) — the last terminal row closes the set.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'completed', VALID_CHUNK_PAYLOADS[1]),
      chunkRow(2, 'completed', VALID_CHUNK_PAYLOADS[2]),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'failed', {}),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.updateValidationReport).toHaveBeenCalledTimes(1);
    const clearCall = adapterInstance.updateValidationReport.mock.calls[0][0];
    expect(clearCall.report.side_effects_pending).toBe(false);
    expect(clearCall.preserveValidationPassed).toBe(true);
  });

  it('a NON-completed billing status fires no side effects and claims nothing', async () => {
    // Only 3 of 11 dimensions covered → billingStatus 'failed' → no cache
    // write, no publishes, so no claim should be set in the finalize write.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'completed', { schemaVersion: '2.0', dimensions: [dimension(2)] }),
      chunkRow(2, 'failed', {}),
      chunkRow(3, 'failed', {}),
      chunkRow(4, 'failed', {}),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    const finalizeCall = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    expect(finalizeCall.validationReport.billing_status).toBe('failed');
    expect(finalizeCall.validationReport.side_effects_pending).toBeUndefined();
    expect(adapterInstance.updateValidationReport).not.toHaveBeenCalled();
  });
});

describe('hasPendingSideEffects reconciliation predicate (unit)', () => {
  it('returns true only for a report with the claim explicitly true', () => {
    expect(hasPendingSideEffects({ side_effects_pending: true })).toBe(true);
    expect(hasPendingSideEffects({ side_effects_pending: false })).toBe(false);
    expect(hasPendingSideEffects({})).toBe(false);
    expect(hasPendingSideEffects(null)).toBe(false);
    const missingPayload: unknown = undefined; // explicit: predicate must accept undefined
    expect(hasPendingSideEffects(missingPayload)).toBe(false);
    expect(hasPendingSideEffects('legacy-string-report')).toBe(false);
    expect(hasPendingSideEffects([{ side_effects_pending: true }])).toBe(false);
    expect(hasPendingSideEffects({ side_effects_pending: 'true' })).toBe(false);
  });
});
