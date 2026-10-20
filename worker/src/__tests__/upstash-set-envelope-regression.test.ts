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
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
      return Promise.resolve(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
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

  it('negative control: the pre-fix envelope body is exactly what poisoned Redis', () => {
    // Reproduces the old behavior to prove the test above catches it.
    const value = 'HELLO';
    const oldBody = JSON.stringify({ value, ex: 604800, get: false, xx: false });
    expect(oldBody).not.toBe(value);
    expect(JSON.parse(oldBody)).toEqual({ value: 'HELLO', ex: 604800, get: false, xx: false });
  });

  it('GET unwraps a legacy SET envelope written before the fix (poisoned keys recover)', async () => {
    const { unwrapLegacySetEnvelope } = await import('../services/UpstashCacheAdapter');
    const real = JSON.stringify([{ author: 'a', text: 't', publishedAt: 'p', likeCount: 1 }]);
    const envelope = JSON.stringify({ value: real, ex: 604800, get: false, xx: false });
    expect(unwrapLegacySetEnvelope(envelope)).toBe(real);
    expect(unwrapLegacySetEnvelope(real)).toBe(real);
    expect(unwrapLegacySetEnvelope(null)).toBeNull();
    const lookalike = JSON.stringify({ value: 'x', other: 1 });
    expect(unwrapLegacySetEnvelope(lookalike)).toBe(lookalike);
  });

  it('GET returns the unwrapped value end-to-end through the adapter', async () => {
    const real = JSON.stringify({ subscriberCount: 10 });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ result: JSON.stringify({ value: real, ex: 604800, get: false, xx: false }) }), { status: 200 })),
    ) as unknown as typeof fetch;
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    expect(await adapter.get('channel-meta:x')).toBe(real);
  });

  it('GET heals a legacy envelope key with a compare-and-set EVAL (bare value, native TTL from inner ex)', async () => {
    const real = JSON.stringify([{ author: 'a', text: 't', publishedAt: 'p', likeCount: 1 }]);
    const envelope = JSON.stringify({ value: real, ex: 3600, get: false, xx: false });
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      const result = url.includes('/get/') ? envelope : 'OK';
      return Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 }));
    }) as unknown as typeof fetch;
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    expect(await adapter.get('comments-sampled:vid')).toBe(real);
    // Never an unconditional SET: a newer concurrent write must not be clobbered.
    expect(calls.some((call) => call.url.includes('/set/'))).toBe(false);
    const heal = calls.find((call) => call.url === 'https://example.upstash.io');
    if (!heal) throw new Error('heal EVAL was not sent');
    const [cmd, script, numKeys, key, expected, value, ttl] = JSON.parse(heal.body) as string[];
    expect(cmd).toBe('EVAL');
    expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(numKeys).toBe('1');
    expect(key).toBe('comments-sampled:vid');
    expect(expected).toBe(envelope);
    expect(value).toBe(real);
    expect(ttl).toBe('3600');
  });

  it('CAS: a newer value written between GET and the heal survives (Lua semantics modelled)', async () => {
    const real = JSON.stringify({ subscriberCount: 1 });
    const envelope = JSON.stringify({ value: real, ex: 3600, get: false, xx: false });
    const newer = JSON.stringify({ subscriberCount: 2 });
    const store = new Map<string, string>([['channel-meta:x', envelope]]);
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/get/')) {
        const result = store.get('channel-meta:x') ?? null;
        store.set('channel-meta:x', newer); // concurrent writer lands right after our GET
        return Promise.resolve(new Response(JSON.stringify({ result }), { status: 200 }));
      }
      const [, , , key, expected, value] = JSON.parse(String(init?.body)) as string[];
      if (store.get(key as string) === expected) store.set(key as string, value as string);
      return Promise.resolve(new Response(JSON.stringify({ result: 0 }), { status: 200 }));
    }) as unknown as typeof fetch;
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    expect(await adapter.get('channel-meta:x')).toBe(real);
    expect(store.get('channel-meta:x')).toBe(newer);
  });

  it('a rejected heal EVAL is logged, not silent', async () => {
    const envelope = JSON.stringify({ value: 'v', ex: 60, get: false, xx: false });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/get/')
        ? new Response(JSON.stringify({ result: envelope }), { status: 200 })
        : new Response(JSON.stringify({ error: 'ERR unknown command' }), { status: 400 })),
    ) as unknown as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    expect(await adapter.get('k')).toBe('v');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('heal rejected'), expect.objectContaining({ status: 400 }));
    warn.mockRestore();
  });

  it('envelope recognition requires a positive-integer ex', async () => {
    const { parseLegacySetEnvelope } = await import('../services/UpstashCacheAdapter');
    for (const ex of [0, -5, 1.5, '3600', null]) {
      expect(parseLegacySetEnvelope(JSON.stringify({ value: 'v', ex }))).toBeNull();
    }
    expect(parseLegacySetEnvelope(JSON.stringify({ value: 'v', ex: 60 }))).toEqual({ value: 'v', ttlSeconds: 60 });
  });

  it('GET of a clean value never writes', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ result: '[1]' }), { status: 200 }));
    }) as unknown as typeof fetch;
    const { UpstashCacheAdapter } = await import('../services/UpstashCacheAdapter');
    const adapter = new UpstashCacheAdapter({ url: 'https://example.upstash.io', token: 't' });
    expect(await adapter.get('comments-sampled:vid')).toBe('[1]');
    expect(calls.some((url) => url.includes('/set/'))).toBe(false);
  });
});
