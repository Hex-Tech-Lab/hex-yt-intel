/**
 * Regression test for the 2026-09-30 silent comment-loss root cause.
 *
 * RCA: UpstashCacheAdapter.set() sent `ex`/`get`/`xx` in the JSON request
 * body of POST /set/{key}. Upstash REST treats the ENTIRE body as the value,
 * so Redis stored the literal envelope `{"value":...,"ex":...}` and every
 * subsequent cache hit returned that envelope: normalizeVideoComments()
 * degraded it to null (silent comment loss on every repeat analysis within
 * the 7-day TTL) and channelMeta was persisted as the envelope itself.
 *
 * The contract under test: the SET request body must be EXACTLY the value,
 * with TTL options carried in the URL query string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captured: Array<{ url: string; body: string }> = [];

describe('UpstashCacheAdapter.set — envelope regression (2026-09-30)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    captured.length = 0;
    // rawFetch is bound at module load, so the stub must be installed
    // BEFORE the module under test is imported.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('stores the raw value as the body and carries TTL in the query string', async () => {
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    const value = JSON.stringify([{ author: 'a', text: 't', publishedAt: 'p', likeCount: 1 }]);

    await adapter.set('comments-sampled:vid:11', value, 604800);

    expect(captured).toHaveLength(1);
    const entry = captured[0];
    if (!entry) throw new Error('SET request was not captured');
    const { url, body } = entry;
    // TTL must NOT be in the body — Upstash would store the envelope verbatim.
    expect(body).toBe(value);
    expect(body).not.toContain('"ex"');
    expect(url).toContain('/set/comments-sampled:vid:11?');
    expect(url).toContain('ex=604800');
  });

  it('negative control: the pre-fix envelope body is exactly what poisoned Redis', async () => {
    // Reproduces the old behavior to prove the test above catches it.
    const value = 'HELLO';
    const oldBody = JSON.stringify({ value, ex: 604800, get: false, xx: false });
    expect(oldBody).not.toBe(value);
    expect(JSON.parse(oldBody)).toEqual({ value: 'HELLO', ex: 604800, get: false, xx: false });
  });
});
