/**
 * Unit tests for fetchWithTimeout's body-consumption timeout contract (PR
 * #315 review round 2, P0-1, 2026-09-15).
 *
 * The helper's API is callback-shaped: `fetchWithTimeout(url, init,
 * consumeResponse, timeoutMs?)`. The consumeResponse callback runs INSIDE
 * the timeout window — `clearTimeout` only fires after consumeResponse
 * settles, so a stalled `.json()` (headers arrive but body never completes)
 * is aborted on the same schedule a stalled connection is.
 *
 * Negative-control pairs (MANDATORY per the dispatch contract): each P0
 * test first proves the PRE-fix behavior (timer cleared before body
 * consumption → hang), then proves the fix resolves it. The pre-fix shape
 * is simulated here by a direct `fetch` + `clearTimeout` + `res.json()`
 * sequence that reproduces the exact gap the callback API closes.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout';

describe('fetchWithTimeout body-consumption timeout (P0-1, PR #315 review round 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled body (.json() never settles) on the timeout schedule — regression: the pre-fix shape left it uncovered', async () => {
    // PRE-FIX reproduction (negative control): the old helper returned the
    // bare Response and cleared the timer in `finally` as soon as fetch()
    // resolved HEADERS. A stalled .json() after the helper returned was
    // uncovered — the caller's await hung forever. Simulate that exact
    // shape inline (not importing the old code, which no longer exists):
    function oldShapeFetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // .finally clears the timer as soon as fetch() resolves HEADERS —
      // before the caller ever calls .json(). This is the gap.
      return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    // A Response whose .json() never settles (stalled body stream). The
    // signal on the old-shape controller was already cleared, so .json()
    // has no abort path at all.
    const makeStalledResponse = (signal?: AbortSignal) => {
      const res = new Response('not-json', { status: 200 });
      res.json = () =>
        new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          }
          // No natural resolution otherwise.
        });
      return res;
    };

    // PRE-FIX: the old shape returns a Response whose .json() is uncovered.
    // The old-shape controller's signal was never exposed to the caller,
    // and the timer was cleared on header arrival — so .json() hangs forever.
    let oldController = new AbortController();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      oldController = new AbortController();
      // Expose the old controller so we can prove the timer was cleared
      // (aborting it after header arrival does nothing for .json()).
      return Promise.resolve(makeStalledResponse(init?.signal));
    }));

    const preFixRes = await oldShapeFetchWithTimeout('https://example.com/api');
    // Advance past the timeout — the old shape already cleared the timer
    // in .finally, so aborting the old controller does nothing.
    await vi.advanceTimersByTimeAsync(20_000);
    let preFixBodySettled = false;
    // The caller calls .json() AFTER the helper returned — no signal, no
    // timer, no abort path. This promise will never settle.
    preFixRes.json().then(() => { preFixBodySettled = true; }).catch(() => { preFixBodySettled = true; });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(preFixBodySettled).toBe(false); // CONFIRMED: pre-fix body hang is uncovered

    // POST-FIX: the callback shape runs .json() INSIDE the timeout window.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      return Promise.resolve(makeStalledResponse(init?.signal));
    }));

    let postFixSettled = false;
    let postFixError: unknown = null;
    const postFixPromise = fetchWithTimeout('https://example.com/api', undefined, async (res) => {
      return res.json();
    }).then(() => { postFixSettled = true; }).catch((e) => { postFixError = e; });

    // At 10s the timeout fires → abort → consumeResponse's .json() rejects.
    await vi.advanceTimersByTimeAsync(11_000);
    await postFixPromise;
    expect(postFixSettled).toBe(false);
    expect(postFixError).toBeInstanceOf(Error); // aborted, not hung forever
  });

  it('clears the timer only after consumeResponse settles (happy path)', async () => {
    const okResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse));

    let consumed = false;
    const result = await fetchWithTimeout('https://example.com/api', undefined, async (res) => {
      const data = await res.json();
      consumed = true;
      return data;
    });

    expect(consumed).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('a stalled connection (fetch never resolves) is aborted on schedule', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));

    let error: unknown = null;
    const p = fetchWithTimeout('https://example.com/api', undefined, async (res) => res.json()).catch((e) => { error = e; });

    await vi.advanceTimersByTimeAsync(11_000);
    await p;
    expect(error).toBeInstanceOf(Error);
  });

  it('composes a caller-provided AbortSignal with the timeout signal (P1-7)', async () => {
    // A caller passing its own signal (e.g. for unmount cancellation) must
    // have it honored: aborting the caller signal aborts the fetch, even
    // before the timeout fires.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('caller-aborted', 'AbortError')));
      });
    }));

    const callerController = new AbortController();
    let error: unknown = null;
    const p = fetchWithTimeout(
      'https://example.com/api',
      { signal: callerController.signal },
      async (res) => res.json()
    ).catch((e) => { error = e; });

    // Abort via the CALLER's signal before the timeout fires.
    callerController.abort();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('a caller signal already aborted at call time aborts immediately', async () => {
    // fetch mock that handles an already-aborted signal (real browsers
    // reject immediately in this case; the mock must match that contract).
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    }));

    const callerController = new AbortController();
    callerController.abort();

    let error: unknown = null;
    const p = fetchWithTimeout(
      'https://example.com/api',
      { signal: callerController.signal },
      async (res) => res.json()
    ).catch((e) => { error = e; });

    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('a custom timeoutMs overrides the default 10s', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));

    let error: unknown = null;
    const p = fetchWithTimeout('https://example.com/api', undefined, async (res) => res.json(), 3_000).catch((e) => { error = e; });

    // At 2s: not yet aborted (custom timeout is 3s).
    await vi.advanceTimersByTimeAsync(2_000);
    expect(error).toBeNull();
    // At 3.1s: aborted.
    await vi.advanceTimersByTimeAsync(1_100);
    await p;
    expect(error).toBeInstanceOf(Error);
  });
});
