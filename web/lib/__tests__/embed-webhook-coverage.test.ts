/**
 * Embed webhook tests — RCA (2026-09-24, vector-coverage).
 *
 * Covers the two behavior changes from the vector-coverage fix:
 * 1. Idempotent skip: the embed job is now published from FOUR finalize
 *    paths (persist route both paths, analysis reaper, aux-remediation,
 *    dimension-remediation) plus the legacy validation-chain route. The
 *    webhook's fetch-before-embed skip is best-effort (two concurrent
 *    deliveries can both embed — the idempotent upsert keeps the result
 *    correct) and avoids the common duplicate-embed case.
 * 2. The production credential-missing 503 branch previously reported only
 *    console.error (zero Sentry visibility) — it now captures to Sentry.
 */
import * as Sentry from '@sentry/nextjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the mock object identity survives vi.resetModules() inside
// loadRoute(): the factory returns this SAME object on every re-import, so
// top-level `Sentry` assertions observe the instance the route actually uses.
const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentryMock);

const supabaseMock = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => supabaseMock.maybeSingle(),
        }),
      }),
    }),
  }),
}));

const vectorIndexMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  upsert: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/upstash-vector', () => ({
  // Mirror the real initializeVectorIndex: null on placeholder/missing creds.
  // skipcq: JS-R1005 -- branch count mirrors the real credential-guard contract under test
  initializeVectorIndex: () => {
    const url = process.env.UPSTASH_VECTOR_REST_URL || '';
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN || '';
    if (!url || url.includes('placeholder') || !token || token.includes('placeholder')) return null;
    return vectorIndexMock;
  },
}));

const embeddingsMock = vi.hoisted(() => ({
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0), costUsd: 0.0001 }),
  generateSparseVector: vi.fn().mockReturnValue({ indices: [1], values: [1] }),
}));

vi.mock('@/lib/embeddings', () => embeddingsMock);

vi.mock('@/lib/qstash-client', () => ({
  verifyQStashSignature: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/usage', () => ({
  logUsage: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/monitoring/sentry-utils', () => ({
  trackExternalCall: (_p: string, _m: string, fn: () => Promise<unknown>) => fn(),
  addBreadcrumb: vi.fn(),
  setUserContext: vi.fn(),
}));

const PAYLOAD = { analysisId: 'a-1', markdown: '# analysis markdown', userId: 'user-1' };

// skipcq: JS-0057 -- test helper in a TS ES module, not a browser script; module scope, not global
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/embed', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'upstash-signature': 'sig', ...headers },
  });
}

// The route uses initializeVectorIndex() at module load — reset modules per test.
// skipcq: JS-0057 -- test helper in a TS ES module, not a browser script; module scope, not global
async function loadRoute() {
  vi.resetModules();
  const mod = await import('@/app/api/webhooks/embed/route');
  return mod.POST;
}

describe('embed webhook — vector-coverage fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vectorIndexMock.fetch.mockReset();
    vectorIndexMock.upsert.mockClear();
    supabaseMock.maybeSingle.mockResolvedValue({
      data: { title: 'T', video_id: 'vid1', analysis_payload: null },
      error: null,
    });
    vi.unstubAllEnvs();
    // Valid (non-placeholder) vector credentials for the normal-path tests;
    // the 503 test overrides with 'placeholder' + VERCEL_ENV=production.
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'https://vector.example.com');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'real-token');
  });

  it('best-effort duplicate skip: skips the embed when the vector already exists (concurrent deliveries may still both embed)', async () => {
    vectorIndexMock.fetch.mockResolvedValue([{ id: 'a-1', vector: null, metadata: {} }]);
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, analysisId: 'a-1', skipped: true, alreadyEmbedded: true });
    expect(embeddingsMock.generateEmbedding).not.toHaveBeenCalled();
    expect(vectorIndexMock.upsert).not.toHaveBeenCalled();
  });

  it('embeds and upserts when the vector is absent', async () => {
    vectorIndexMock.fetch.mockResolvedValue([null]);
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, analysisId: 'a-1' });
    expect(embeddingsMock.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(vectorIndexMock.upsert).toHaveBeenCalledTimes(1);
    expect(vectorIndexMock.upsert.mock.calls[0][0]).toMatchObject({
      id: 'a-1',
      metadata: { title: 'T', videoId: 'vid1', userId: 'user-1', analysisId: 'a-1' },
    });
  });

  it('continues with the embed when the presence-check fetch fails (check is an optimization only)', async () => {
    vectorIndexMock.fetch.mockRejectedValue(new Error('upstash 500'));
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);

    expect(res.status).toBe(200);
    expect(vectorIndexMock.upsert).toHaveBeenCalledTimes(1);
  });

  it('the production credential-missing branch returns 503 AND reports to Sentry (previously console-only)', async () => {
    vectorIndexMock.fetch.mockResolvedValue([]);
    // initializeVectorIndex returns null when creds are placeholders — stub the env to force it.
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'placeholder');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'placeholder');
    vi.stubEnv('VERCEL_ENV', 'production');
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);

    expect(res.status).toBe(503);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Upstash Vector credentials missing in production — embed job rejected (503)',
      expect.objectContaining({ level: 'error' })
    );
  });

  it('metadata transient DB error returns 503 and reports to Sentry (never writes phantom video_id)', async () => {
    vectorIndexMock.fetch.mockResolvedValue([null]);
    supabaseMock.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection timeout' },
    });
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({ success: false, error: expect.stringContaining('Database error') });
    expect(vectorIndexMock.upsert).not.toHaveBeenCalled();
    // PR #438 C2 negative control: on the old order (embed first) this WOULD
    // have been called — a transient DB failure must not spend on embeddings.
    expect(embeddingsMock.generateEmbedding).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'connection timeout' }),
      expect.objectContaining({
        tags: { service: 'webhook', operation: 'embed', phase: 'metadata_fetch' },
      })
    );
  });

  it('metadata row genuinely missing returns 400 and reports to Sentry (never writes phantom video_id)', async () => {
    vectorIndexMock.fetch.mockResolvedValue([null]);
    supabaseMock.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ success: false, error: expect.stringContaining('Analysis metadata not found') });
    expect(vectorIndexMock.upsert).not.toHaveBeenCalled();
    // PR #438 C2 negative control: a permanently-missing row must not spend either.
    expect(embeddingsMock.generateEmbedding).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Analysis metadata not found for embedding (permanent error)',
      expect.objectContaining({
        level: 'warning',
        tags: { service: 'webhook', operation: 'embed', phase: 'metadata_not_found' },
      })
    );
  });

  it('in non-production without vector index, logs warning and captures Sentry message while returning 200', async () => {
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'placeholder');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'placeholder');
    vi.stubEnv('VERCEL_ENV', 'development');
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, skipped: true });
    expect(vectorIndexMock.upsert).not.toHaveBeenCalled();
    // PR #438 C3: the skip must be Sentry-visible with the vector-skip tag contract.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Embedding generation skipped: Upstash Vector credentials are not configured',
      expect.objectContaining({
        level: 'warning',
        tags: { service: 'webhook', operation: 'embed', phase: 'vector_skip_upsert' },
      })
    );
  });

  it('in non-production when vectorIndex is not configured at upsert phase, warns and captures Sentry message while 200', async () => {
    // initializeVectorIndex initially returns null
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'placeholder');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'placeholder');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const POST_ = await loadRoute();

    const res = await POST_(post(PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect(vectorIndexMock.upsert).not.toHaveBeenCalled();
    // PR #438 C3: same Sentry contract, asserted independently for preview.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Embedding generation skipped: Upstash Vector credentials are not configured',
      expect.objectContaining({
        level: 'warning',
        tags: { service: 'webhook', operation: 'embed', phase: 'vector_skip_upsert' },
      })
    );
  });
});
