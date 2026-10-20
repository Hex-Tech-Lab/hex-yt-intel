/**
 * R3b 2.3W worker-half tests: the `event: plan` SSE frame contract.
 *
 * Contract under test (must mirror web/lib/usecases/PlanAnalysisUseCase +
 * web/hooks/useSSEStream's plan parser):
 *   event: plan
 *   data: {"v":1,"source":"inline"|"worker","K":int,"streamCount":int,
 *          "cells":[{jevChunkIndex,chunkIndex,startWord,endWord,sha256}],
 *          "truncatedFallback":bool}
 *
 * Resolution order (ADR 037 Addendum A):
 *   1. inline req.jevPlan -> emitted directly, /plan NOT called.
 *   2. S2S POST {appUrl}/api/analyses/{id}/plan -> worker emits the plan.
 *   3. any failure -> K=1 fallback emitted, analysis continues.
 * Projective bundles never get a plan frame and never call /plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const capturedPlanFetches: Array<{ url: string; body: Record<string, unknown> }> = [];

// Minimal-but-sufficient StreamRequest stub. The worker's own token verify
// runs before buildStreamResponse, but tests drive buildStreamResponse
// through the route's exported surface indirectly; we exercise the plan
// logic through the module's internal helpers by importing the route module
// and reaching the helpers via the exported surface. Since
// buildStreamResponse is module-private, we test through fetchJevPlan +
// isValidJevPlan/fallbackPlan if exported, else via a harness. The helpers
// were made testable via named export (see analysis.ts bottom exports).
const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const VIDEO_ID = 'vid123';
const TRANSCRIPT = 'alpha beta gamma delta epsilon';
const APP_URL = 'https://app.example.test';

function makePlan() {
  return {
    K: 2,
    streamCount: 11,
    cells: [
      { jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 3, sha256: 'aa'.repeat(32) },
      { jevChunkIndex: 1, chunkIndex: 2, startWord: 3, endWord: 5, sha256: 'bb'.repeat(32) },
    ],
    estimateCents: 42,
    truncatedFallback: false,
  };
}

describe('Jev plan resolution — worker half (R3b 2.3W)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    capturedPlanFetches.length = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      capturedPlanFetches.push({ url: String(input), body });
      return Promise.resolve(new Response(JSON.stringify({ cached: false, plan: makePlan() }), { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('fetchJevPlan sends a signed body and returns the plan on 2xx', async () => {
    const { fetchJevPlan } = await import('../routes/analysis');
    const result = await fetchJevPlan({
      appUrl: APP_URL,
      analysisId: ANALYSIS_ID,
      videoId: VIDEO_ID,
      transcript: TRANSCRIPT,
      signingKey: SECRET,
    });

    expect(capturedPlanFetches).toHaveLength(1);
    const { url, body } = capturedPlanFetches[0]!;
    expect(url).toBe(`${APP_URL}/api/analyses/${ANALYSIS_ID}/plan`);
    expect(body.videoId).toBe(VIDEO_ID);
    expect(body.transcript).toBe(TRANSCRIPT);
    expect(typeof body.sig).toBe('string');
    expect((body.sig as string).length).toBe(64);
    expect(typeof body.exp).toBe('number');

    // The signature must verify against the SAME canonical message the plan
    // route reconstructs (boundContentMessage('plan', id, exp, canonicalJson(body minus sig/exp))).
    const { hmacHex, signBoundContent } = await import('../crypto');
    const { canonicalJson } = await import('../../../web/lib/utils/canonical-json');
    const { sig: _sig, exp: _exp, ...signedBody } = body;
    const expected = await signBoundContent(SECRET, 'plan', ANALYSIS_ID, body.exp as number, canonicalJson(signedBody));
    // canonicalJson sorts keys; the literal expected string must be sorted too.
    expect(canonicalJson(signedBody)).toBe('{"transcript":"alpha beta gamma delta epsilon","videoId":"vid123"}');
    void hmacHex;
    expect(result).toEqual(makePlan());
  });

  it('returns null on non-2xx (K=1 fallback path)', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 }))) as unknown as typeof fetch;
    const { fetchJevPlan } = await import('../routes/analysis');
    const result = await fetchJevPlan({ appUrl: APP_URL, analysisId: ANALYSIS_ID, videoId: VIDEO_ID, transcript: TRANSCRIPT, signingKey: SECRET });
    expect(result).toBeNull();
  });

  it('returns null on malformed plan body (shape check)', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ cached: false, plan: { K: 'not-a-number' } }), { status: 200 }))) as unknown as typeof fetch;
    const { fetchJevPlan } = await import('../routes/analysis');
    const result = await fetchJevPlan({ appUrl: APP_URL, analysisId: ANALYSIS_ID, videoId: VIDEO_ID, transcript: TRANSCRIPT, signingKey: SECRET });
    expect(result).toBeNull();
  });

  it('returns null on network failure (K=1 fallback path)', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    const { fetchJevPlan } = await import('../routes/analysis');
    const result = await fetchJevPlan({ appUrl: APP_URL, analysisId: ANALYSIS_ID, videoId: VIDEO_ID, transcript: TRANSCRIPT, signingKey: SECRET });
    expect(result).toBeNull();
  });

  it('isValidJevPlan accepts a real plan and rejects malformed variants', async () => {
    const { isValidJevPlan } = await import('../routes/analysis');
    expect(isValidJevPlan(makePlan())).toBe(true);
    expect(isValidJevPlan(null)).toBe(false);
    expect(isValidJevPlan('plan')).toBe(false);
    expect(isValidJevPlan({ ...makePlan(), K: 0 })).toBe(false);
    expect(isValidJevPlan({ ...makePlan(), cells: [{ jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 3 }] })).toBe(false);
    expect(isValidJevPlan({ ...makePlan(), truncatedFallback: 'yes' })).toBe(false);
  });

  it('fallbackPlan emits a degenerate K=1 plan', async () => {
    const { fallbackPlan } = await import('../routes/analysis');
    expect(fallbackPlan(5)).toEqual({ K: 1, streamCount: 5, cells: [], estimateCents: 0, truncatedFallback: false });
  });

  it('negative control: an unsigned/wrong-secret body must NOT verify against the plan route message layout', async () => {
    // Re-drive the real signed fetch (this test runs in its own beforeEach
    // state, so capturedPlanFetches is empty until we make the call).
    const { fetchJevPlan } = await import('../routes/analysis');
    await fetchJevPlan({ appUrl: APP_URL, analysisId: ANALYSIS_ID, videoId: VIDEO_ID, transcript: TRANSCRIPT, signingKey: SECRET });
    expect(capturedPlanFetches.length).toBeGreaterThan(0);

    const { signBoundContent } = await import('../crypto');
    const { canonicalJson } = await import('../../../web/lib/utils/canonical-json');
    const { sig: _sig, exp, ...signedBody } = capturedPlanFetches[0]!.body;
    const wrongSecretSig = await signBoundContent('wrong-secret', 'plan', ANALYSIS_ID, exp as number, canonicalJson(signedBody));
    const rightSecretSig = await signBoundContent(SECRET, 'plan', ANALYSIS_ID, exp as number, canonicalJson(signedBody));
    expect(wrongSecretSig).not.toBe(rightSecretSig);
    expect(rightSecretSig).toBe(capturedPlanFetches[0]!.body.sig);
  });
});
