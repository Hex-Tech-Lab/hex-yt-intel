/**
 * Route-level tests for the PR #314 second review round findings:
 *
 * P0 — markChunkFailed CAS race (data loss). A concurrent writer can replace
 * a malformed `completed` chunk row with a VALID `completed` payload (bumping
 * updated_at) between the route's read and the demotion write. The old code
 * guarded only on `status='completed'` and unconditionally deleted the
 * chunkMap entry — it would have demoted the now-valid row and excluded it
 * from the stitch. The fix scopes the CAS to `updated_at` (the exact row
 * revision), refetches on a CAS miss, and RESTORES a now-valid row into
 * chunkMap. On a thrown DB error, the chunkMap entry is NOT deleted (the
 * stitch skips the malformed payload via hasUsableDimensionsPayload, and the
 * row stays 'completed' in DB so the reaper can still recover it).
 *
 * P1 — primitive JSON payload crash. The settled-stitch path used
 * `'dimensions' in chunk.payload` which throws TypeError on a primitive
 * (string/number/boolean/null). The DB's JSONB column can contain any JSON
 * value despite the port typing payload as Record<string, unknown>. The fix
 * uses a shared `hasUsableDimensionsPayload` predicate with a typeof guard.
 *
 * P2 — malformed vs payload-less log misclassification. `isPayloadlessChunk`
 * was `!validPayload`, which was true for BOTH null/undefined AND
 * malformed-but-truthy objects (e.g. {}, {foo:'bar'}). The log reason never
 * reached 'malformed-object'. The fix makes the classification mutually
 * exclusive.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyContentSig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stream-token', () => ({ verifyContentSig }));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  // WorkflowConductor.routeToRoom awaits Sentry.flush(2000) after the handler
  // settles — the mock must define it or the route 500s with an "No flush
  // export" error (this was the root cause of the CI Unit Tests failure).
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

vi.mock('@/lib/services/cache', () => ({
  setAnalysisCache: vi.fn().mockResolvedValue(null),
  generateCacheKey: vi.fn().mockReturnValue('cache-key'),
}));

import { POST } from '@/app/api/analyses/persist/route';
import { hasUsableDimensionsPayload } from '@/lib/services/stitch-analysis-chunks';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';
const VIDEO_ID = 'gKgWYFOhZx0';

function dimension(dimNumber: number): { number: number; name: string; content: string } {
  return { number: dimNumber, name: `Dimension ${dimNumber}`, content: `content for dim ${dimNumber}` };
}

const VALID_CHUNK_PAYLOADS: Record<number, unknown> = {
  3: { schemaVersion: '2.0', dimensions: [dimension(2), dimension(4), dimension(6)] },
  4: { schemaVersion: '2.0', dimensions: [dimension(5), dimension(7), dimension(10)] },
  5: { schemaVersion: '2.0', dimensions: [dimension(3), dimension(9), dimension(11)] },
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

function chunkRow(index: number, status: string, payload: unknown, updatedAt?: string) {
  return {
    chunk_index: index,
    dimensions_covered: [],
    payload,
    status,
    updated_at: updatedAt ?? new Date().toISOString(),
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

describe('P0 — markChunkFailed CAS race: concurrent writer replaces malformed row with valid payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(undefined);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.markChunkFailed.mockResolvedValue(true);
  });

  it('NEGATIVE CONTROL: old code would have demoted the valid row and discarded it — fixed code RESTORES the valid payload into the stitch', async () => {
    // The race: chunk 2 was 'completed' with malformed payload {} when the
    // route read it. Between the read and markChunkFailed, a concurrent
    // writer (e.g. a retry that succeeded) replaced it with a VALID
    // completed payload (bumping updated_at). markChunkFailed's scoped CAS
    // misses (returns false). The route refetches, sees the valid payload,
    // and RESTORES it into chunkMap — the stitch includes chunk 2's dims.
    //
    // OLD CODE (pre-fix): markChunkFailed guarded only on status='completed',
    // so it would have demoted the now-valid row (count=1, returns true),
    // and chunkMap.delete would have removed it — the stitch would be
    // missing chunk 2's dimensions, silently losing valid data.
    const malformedUpdatedAt = '2026-09-15T00:00:00Z';
    const validUpdatedAt = '2026-09-15T00:01:00Z';
    const validPayloadForChunk2 = { schemaVersion: '2.0', dimensions: [dimension(8)] };

    // First findAnalysisChunks (route's initial read): chunk 2 is malformed.
    // Second findAnalysisChunks (refetch after CAS miss): chunk 2 is now valid.
    adapterInstance.findAnalysisChunks
      .mockResolvedValueOnce([
        chunkRow(1, 'failed', {}, malformedUpdatedAt),
        chunkRow(2, 'completed', {}, malformedUpdatedAt),
        chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
        chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
        chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
      ])
      .mockResolvedValueOnce([
        chunkRow(1, 'failed', {}, malformedUpdatedAt),
        chunkRow(2, 'completed', validPayloadForChunk2, validUpdatedAt),
        chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
        chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
        chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
      ]);

    // CAS miss — the row's updated_at no longer matches the observed value.
    adapterInstance.markChunkFailed.mockResolvedValue(false);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);

    // markChunkFailed was called with the observed updated_at from the
    // malformed row (not the refetched valid row's updated_at).
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledTimes(1);
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 2, observedUpdatedAt: malformedUpdatedAt })
    );

    // The refetch happened (findAnalysisChunks called twice).
    expect(adapterInstance.findAnalysisChunks).toHaveBeenCalledTimes(2);

    // The finalize committed — and the stitch INCLUDES chunk 2's valid
    // dimensions (dim 8), proving the valid payload was restored.
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    const stitchedDims = call.payload.dimensions.map((entry: { number: number }) => entry.number).sort((left: number, right: number) => left - right);
    expect(stitchedDims).toContain(8);
    expect(stitchedDims).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('a thrown DB error from markChunkFailed (after bounded retries) DEFERS the finalize with an observable 503 — parent is NOT silently committed without the chunk', async () => {
    // Item-2 negative control (the OLD intermediate behavior): chunk 2 is
    // 'completed' with malformed payload. markChunkFailed THROWS on every
    // attempt (genuine DB error, not a CAS miss). The earlier fix caught the
    // throw and let the finalize proceed with a stitch that silently OMITTED
    // chunk 2 — while the DB row stayed 'completed' + malformed (the reaper's
    // completed-only filter would keep treating it as recoverable forever).
    // The fixed behavior: bounded retry (2 attempts), then the finalize is
    // ABORTED with an observable 503 so the worker re-sends the whole persist
    // (re-deriving the settled set and retrying the demotion) instead of the
    // parent being silently committed without the chunk.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'failed', {}),
      chunkRow(2, 'completed', {}),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);
    adapterInstance.markChunkFailed.mockRejectedValue(new Error('connection refused'));

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    // Observable failure — NOT a silent 200.
    expect(res.status).toBe(503);

    // Bounded retry: exactly 2 attempts (maxAttempts=2), then give up.
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledTimes(2);
    // No refetch happened (refetch only happens on CAS miss / false return,
    // not on thrown error).
    expect(adapterInstance.findAnalysisChunks).toHaveBeenCalledTimes(1);

    // The finalize was NOT committed — no parent write, no side effects.
    expect(adapterInstance.updateAnalysisResult).not.toHaveBeenCalled();
  });

  it('a transient markChunkFailed error succeeds on the bounded retry — the demotion is confirmed and the finalize commits', async () => {
    // First attempt throws, second succeeds (transient DB blip): the bounded
    // retry resolves the demotion instead of deferring the whole finalize.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'failed', {}),
      chunkRow(2, 'completed', {}),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);
    adapterInstance.markChunkFailed
      .mockRejectedValueOnce(new Error('transient blip'))
      .mockResolvedValueOnce(true);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledTimes(2);
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
  });

  it('CAS miss where refetched row is now failed (already demoted by concurrent writer) — chunk excluded from stitch', async () => {
    adapterInstance.findAnalysisChunks
      .mockResolvedValueOnce([
        chunkRow(1, 'failed', {}),
        chunkRow(2, 'completed', {}, '2026-09-15T00:00:00Z'),
        chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
        chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
        chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
      ])
      .mockResolvedValueOnce([
        chunkRow(1, 'failed', {}),
        chunkRow(2, 'failed', {}, '2026-09-15T00:00:30Z'),
        chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
        chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
        chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
      ]);
    adapterInstance.markChunkFailed.mockResolvedValue(false);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(adapterInstance.updateAnalysisResult).toHaveBeenCalledTimes(1);
    const call = adapterInstance.updateAnalysisResult.mock.calls[0][0];
    const stitchedDims = call.payload.dimensions.map((entry: { number: number }) => entry.number).sort((left: number, right: number) => left - right);
    expect(stitchedDims).not.toContain(8);
    expect(stitchedDims).toEqual([2, 3, 4, 5, 6, 7, 9, 10, 11]);
  });
});

describe('P1 — primitive JSON payload does not crash the settled-stitch path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(undefined);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.markChunkFailed.mockResolvedValue(true);
  });

  it.each([
    ['string payload', 'not-an-object'],
    ['number payload', 42],
    ['boolean payload', true],
    ['null payload', null],
    ['array payload', [1, 2, 3]],
    ['empty object', {}],
    ['object without dimensions', { foo: 'bar' }],
  ])('settled-stitch path handles %s without throwing (hasUsableDimensionsPayload predicate)', async (_name, primitivePayload) => {
    // Chunk 2 is 'completed' with a primitive payload. The route must not
    // crash when filtering malformed completed chunks or checking the
    // contract. The primitive is reclassified to failed and excluded.
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'failed', {}),
      chunkRow(2, 'completed', primitivePayload),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    // The primitive was detected as malformed and markChunkFailed was called.
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledTimes(1);
    expect(adapterInstance.markChunkFailed).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 2 })
    );
  });

  it('valid {dimensions:{...}} payload is classified as usable (not malformed)', async () => {
    const validPayload = { schemaVersion: '2.0', dimensions: [dimension(8)] };
    adapterInstance.findAnalysisChunks.mockResolvedValue([
      chunkRow(1, 'failed', {}),
      chunkRow(2, 'completed', validPayload),
      chunkRow(3, 'completed', VALID_CHUNK_PAYLOADS[3]),
      chunkRow(4, 'completed', VALID_CHUNK_PAYLOADS[4]),
      chunkRow(5, 'completed', VALID_CHUNK_PAYLOADS[5]),
    ]);

    const res = await POST(
      post({ payload: VALID_CHUNK_PAYLOADS[5], chunkIndex: 5, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    // Valid payload — no reclassification needed.
    expect(adapterInstance.markChunkFailed).not.toHaveBeenCalled();
  });

  describe('hasUsableDimensionsPayload predicate (direct unit tests)', () => {
    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['array', [1, 2, 3]],
    ['empty object', {}],
      ['object without dimensions key', { foo: 'bar' }],
      ['object with non-array dimensions', { dimensions: 'not-an-array' }],
    ])('returns false for %s', (_name, value) => {
      expect(hasUsableDimensionsPayload(value)).toBe(false);
    });

    it('returns true for a valid {dimensions: Array} payload', () => {
      expect(hasUsableDimensionsPayload({ dimensions: [] })).toBe(true);
      expect(hasUsableDimensionsPayload({ dimensions: [{ number: 1 }] })).toBe(true);
    });

    it('OLD CHECK: "dimensions" in payload throws TypeError on primitives (proof of the bug)', () => {
      // The old code used `'dimensions' in chunk.payload` directly. This
      // throws TypeError when the LHS is a primitive — the exact crash the
      // predicate fixes. Proved here so the negative control is explicit.
      const primitivePayloads = ['hello', 42, true];
      for (const p of primitivePayloads) {
        expect(() => 'dimensions' in (p as any)).toThrow(TypeError);
      }
      // null is a special case — `in` on null also throws.
      expect(() => 'dimensions' in (null as any)).toThrow(TypeError);
    });

    it('FIXED: hasUsableDimensionsPayload does NOT throw on any primitive', () => {
      const allPayloads = ['hello', 42, true, null, undefined, {}, { foo: 'bar' }];
      for (const p of allPayloads) {
        expect(() => hasUsableDimensionsPayload(p)).not.toThrow();
      }
    });
  });
});

describe('P2 — malformed vs payload-less log classification is mutually exclusive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    verifyContentSig.mockResolvedValue(true);
    adapterInstance.findAnalysisForPersist.mockResolvedValue(ROW);
    adapterInstance.persistAnalysisChunk.mockResolvedValue(undefined);
    adapterInstance.updateAnalysisResult.mockResolvedValue({ updated: true });
    adapterInstance.markChunkFailed.mockResolvedValue(true);
    // Only this bundle's own failed row — no finalize.
    adapterInstance.findAnalysisChunks.mockResolvedValue([chunkRow(1, 'failed', {})]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a null payload logs reason "payload-less" (not "malformed-object")', async () => {
    const res = await POST(
      post({ payload: null, chunkIndex: 1, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unusable chunk payload'),
      expect.objectContaining({ reason: 'payload-less' })
    );
  });

  it('a malformed-object payload (e.g. {foo:"bar"}) logs reason "malformed-object" (not "payload-less")', async () => {
    const res = await POST(
      post({ payload: { foo: 'bar' }, chunkIndex: 1, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unusable chunk payload'),
      expect.objectContaining({ reason: 'malformed-object' })
    );
  });

  it('an empty-object payload ({}) logs reason "malformed-object" (not "payload-less")', async () => {
    const res = await POST(
      post({ payload: {}, chunkIndex: 1, totalChunks: 5, status: 'completed', model: 'm' })
    );
    expect(res.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unusable chunk payload'),
      expect.objectContaining({ reason: 'malformed-object' })
    );
  });
});
