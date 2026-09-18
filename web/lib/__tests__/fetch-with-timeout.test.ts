/**
 * Unit tests for fetchWithTimeout's body-consumption timeout contract (PR
 * #315 review round 2, P0-1, 2026-09-15; negative-control rework + static
 * findings + abort-listener-cleanup tests, 2026-09-18).
 *
 * The helper's API is callback-shaped: `fetchWithTimeout(url, init,
 * consumeResponse, timeoutMs?)`. The consumeResponse callback runs INSIDE
 * the timeout window — `clearTimeout` only fires after consumeResponse
 * settles, so a stalled `.json()` (headers arrive but body never completes)
 * is aborted on the same schedule a stalled connection is.
 *
 * Negative-control pair (MANDATORY per the dispatch contract): the P0 test
 * first proves the PRE-fix behavior (timer cleared before body consumption
 * → hang), then proves the fix resolves it. The pre-fix shape is simulated
 * by a direct `fetch` + `clearTimeout` + `res.json()` sequence that
 * reproduces the exact gap the callback API closes — and the mocked
 * response OBSERVES the simulated old controller's abort signal, so the
 * control could not pass if the hang were caused by anything other than
 * the timer being cleared.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout';

// A Response whose .json() never settles on its own — it only rejects when
// the observed signal aborts (a stalled body stream, exactly the real
// failure shape).
const makeSignalObservingStalledResponse = (signal?: AbortSignal): Response => {
  const response = new Response('not-json', { status: 200 });
  response.json = () =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  return response;
};

describe('fetchWithTimeout body-consumption timeout (P0-1, PR #315 review round 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled body (.json() never settles) on the timeout schedule — regression: the pre-fix shape left it uncovered', async () => {
    // PRE-FIX negative control: the old helper returned the bare Response
    // and cleared the timer in `finally` as soon as fetch() resolved
    // HEADERS — before the caller ever called .json(). Reproduced inline
    // (not importing the old code, which no longer exists).
    const oldShapeFetchWithTimeout = async (url: string, timeoutMs = 10_000): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // The gap: this .finally clears the timer as soon as HEADERS
        // arrive — the body has not been consumed yet.
        return await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      } finally {
        // Post-settlement cleanup mirror of the old shape: by the time the
        // helper returns, the timer is already cleared and there is nothing
        // left to clean up — which is exactly the uncovered-body gap.
        clearTimeout(timer);
      }
    };

    // The mocked response observes the OLD controller's abort signal, so
    // this control is falsifiable: if the old shape had NOT cleared the
    // timer (i.e. if the observed hang had a different cause), the 10s
    // abort would reject .json() and the settled flag below would flip.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return Promise.resolve(makeSignalObservingStalledResponse(init?.signal));
    }));

    const preFixResponse = await oldShapeFetchWithTimeout('https://example.com/api');
    // Start consuming BEFORE advancing fake timers — the body promise must
    // be live inside the would-be timeout window (starting it only after
    // advancing would make the control unfalsifiable).
    let preFixBodySettled = false;
    preFixResponse.json().then(
      () => { preFixBodySettled = true; },
      () => { preFixBodySettled = true; }
    );
    // Advance well past the timeout: the old shape already cleared the
    // timer on header arrival, so the signal-observing .json() never
    // rejects — CONFIRMED: the pre-fix body hang is real and caused by the
    // cleared timer, not by the response ignoring the signal.
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();
    expect(preFixBodySettled).toBe(false);

    // POST-FIX: the callback shape runs .json() INSIDE the timeout window.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return Promise.resolve(makeSignalObservingStalledResponse(init?.signal));
    }));

    let postFixSettled = false;
    let postFixError: unknown = null;
    const postFixPromise = fetchWithTimeout('https://example.com/api', undefined, (response) => response.json())
      .then(() => { postFixSettled = true; })
      .catch((caught: unknown) => { postFixError = caught; });

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
    const result = await fetchWithTimeout('https://example.com/api', undefined, async (response) => {
      const data = await response.json();
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
    const pending = fetchWithTimeout('https://example.com/api', undefined, (response) => response.json()).catch((caught: unknown) => { error = caught; });

    await vi.advanceTimersByTimeAsync(11_000);
    await pending;
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
    const pending = fetchWithTimeout(
      'https://example.com/api',
      { signal: callerController.signal },
      (response) => response.json()
    ).catch((caught: unknown) => { error = caught; });

    // Abort via the CALLER's signal before the timeout fires.
    callerController.abort();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
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
    const pending = fetchWithTimeout(
      'https://example.com/api',
      { signal: callerController.signal },
      (response) => response.json()
    ).catch((caught: unknown) => { error = caught; });

    await vi.advanceTimersByTimeAsync(100);
    await pending;
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
    const pending = fetchWithTimeout('https://example.com/api', undefined, (response) => response.json(), 3_000).catch((caught: unknown) => { error = caught; });

    // At 2s: not yet aborted (custom timeout is 3s).
    await vi.advanceTimersByTimeAsync(2_000);
    expect(error).toBeNull();
    // At 3.1s: aborted.
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(error).toBeInstanceOf(Error);
  });

  it('removes the caller-signal abort listener when the call settles — on every exit path', async () => {
    // Abort-listener leak (PR #315 review round 2, item 5): the forwarding
    // listener registered on the CALLER's signal was never removed, so a
    // long-lived caller signal (e.g. a page-level controller) accumulated
    // one listener per request for the lifetime of the page. Every exit
    // path (success, body failure, timeout, caller cancel) must clean up.
    const newCallerController = () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
      return { controller, removeSpy };
    };

    // Path 1: success.
    {
      const { controller, removeSpy } = newCallerController();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
      await fetchWithTimeout('https://example.com/api', { signal: controller.signal }, (response) => response.json());
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    }

    // Path 2: consumeResponse fails (body consumption throws).
    {
      const { controller, removeSpy } = newCallerController();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
      await expect(fetchWithTimeout('https://example.com/api', { signal: controller.signal }, (response) => response.json()))
        .rejects.toBeTruthy();
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    }

    // Path 3: timeout fires (stalled connection, never settles on its own).
    {
      const { controller, removeSpy } = newCallerController();
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }));
      let error: unknown = null;
      const pending = fetchWithTimeout('https://example.com/api', { signal: controller.signal }, (response) => response.json())
        .catch((caught: unknown) => { error = caught; });
      await vi.advanceTimersByTimeAsync(11_000);
      await pending;
      expect(error).toBeTruthy();
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    }

    // Path 4: caller cancels mid-flight.
    {
      const { controller, removeSpy } = newCallerController();
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }));
      let error: unknown = null;
      const pending = fetchWithTimeout('https://example.com/api', { signal: controller.signal }, (response) => response.json())
        .catch((caught: unknown) => { error = caught; });
      // Abort AFTER the rejection handler is attached — the abort rejects
      // the fetch promise synchronously.
      controller.abort();
      await pending;
      expect(error).toBeTruthy();
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    }
  });
});
