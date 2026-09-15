/**
 * Malformed-body + 4xx non-rearm resilience tests for useKnowledgeGraph
 * (PR #315 review round 2, P0-2/P0-3, 2026-09-15).
 *
 * WHY a separate file: qa-intel's ComplexityRule (Monolithic File, >500
 * raw lines) flagged the combined file after this PR added the P0-2/P0-3
 * describe on top of the existing fallback + fetch-resilience tests. The
 * rule's own fix is "decompose into smaller, domain-specific modules" —
 * the malformed-body/4xx-non-rearm domain is a distinct concern from the
 * 5xx/network-reject resilience in the sibling file. Same pattern as
 * useAutoRestoreAnalysis-resilience.test.tsx's decomposition.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

describe('useKnowledgeGraph malformed-body + 4xx non-rearm (PR #315 review round 2, P0-2/P0-3, 2026-09-15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    useSynthesisNucleus.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function seedAnalysis(id: string) {
    useSynthesisNucleus.getState().initializeAnalysis({
      id,
      videoId: `${id}-video`,
      title: 'Malformed body test',
      dimensions: {},
    });
  }

  it('P0-2: invalid JSON body is treated as retryable and settles loading on budget exhaustion (negative-control: pre-fix left loading stuck)', async () => {
    // PRE-FIX: res.json() ran OUTSIDE try/catch, so a SyntaxError from
    // invalid JSON was an unhandled rejection — `loading` never settled,
    // no retry scheduled, no error surfaced. This test proves the fix:
    // invalid JSON enters the retryable bucket and settles loading on
    // exhaustion.
    seedAnalysis('analysis-kg-invalid-json');
    const fetchMock = vi.fn().mockResolvedValue(
      // 200 with invalid JSON body
      new Response('not-valid-json{{{', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-invalid-json'));

    // Attempt 1 (immediate) + 3 retries at 5s/10s/15s = 4 total.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // loading must settle (not stuck forever) — the pre-fix bug.
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it('P0-2: valid JSON but malformed entities/relations shape is treated as retryable', async () => {
    // A 200 body with valid JSON but a wrong shape (entities not an array)
    // is a transient failure — retryable, not permanent.
    seedAnalysis('analysis-kg-malformed-shape');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entities: 'not-an-array', relations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-malformed-shape'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it('P0-2: a stalled body (.json() never settles) is aborted by the timeout and enters the retry schedule', async () => {
    // The body-level timeout gap (P0-1): a Response whose headers arrive
    // but whose .json() never completes must be aborted on the timeout
    // schedule and enter the retryable bucket — not hang loading forever.
    seedAnalysis('analysis-kg-body-stall');
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const res = new Response('not-json', { status: 200 });
      res.json = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      return Promise.resolve(res);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-body-stall'));

    // Attempt 1: timeout at 10s -> 5s retry -> attempt 2 at ~15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Exhaust the budget: 4 attempts total, loading settles.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it('P0-3: a 4xx response does NOT arm the online-event recovery — multiple online events produce no refetch', async () => {
    // PRE-FIX: the non-5xx branch set lastAttemptFailed=true, so every
    // later 'online' event re-fetched a 401/404 that would never succeed.
    // The fix: 4xx is permanent — lastAttemptFailed stays false, online
    // listener does not re-arm.
    seedAnalysis('analysis-kg-4xx-no-rearm');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-4xx-no-rearm'));

    // The 401 settles immediately (no retry budget spent).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);

    // Multiple online events must NOT trigger a refetch.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — no re-arm
    unmount();
  });

  it('P0-3 negative-control: a 5xx (retryable) DOES arm the online-event recovery after budget exhaustion', async () => {
    // Proves the 4xx test above is specifically about 4xx being permanent,
    // not a blanket "online never re-arms" regression — a 5xx still arms.
    seedAnalysis('analysis-kg-5xx-rearm');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Internal server error"}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-5xx-rearm'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const afterExhaustion = fetchMock.mock.calls.length;
    expect(afterExhaustion).toBe(4);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock.mock.calls.length).toBe(afterExhaustion + 1);
    unmount();
  });

  it('P0-2 recovery: a malformed body on attempt 1 + a valid body on retry 2 renders the graph', async () => {
    // Proves malformed-body is genuinely retryable (not just "settles on
    // exhaustion"): a retry that succeeds must render the graph.
    seedAnalysis('analysis-kg-malformed-then-ok');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('invalid-json{{{', { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-malformed-then-ok'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.graph.nodes.length).toBe(1);
    expect(result.current.loading).toBe(false);
    unmount();
  });
});
