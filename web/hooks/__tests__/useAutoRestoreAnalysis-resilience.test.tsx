/**
 * Transient-failure retry tests for useAutoRestoreAnalysis (extracted from
 * useAutoRestoreAnalysis.test.tsx, 2026-09-15).
 *
 * WHY a separate file: qa-intel's ComplexityRule (Monolithic File, >500
 * raw lines) flagged the combined file after PR #313 added the resilience
 * describe on top of the already-long auto-restore contract tests. The
 * rule's own fix is "decompose into smaller, domain-specific modules" —
 * the resilience/retry domain (PR #313's connection-drop fix + this PR's
 * P0b timeout) is a distinct concern from the store-contract restoration
 * flow, so it lives here. Zero test content changed in the move.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts
 * and the happy-dom + RTL pattern from hooks/__tests__/useChapters.test.tsx.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAutoRestoreAnalysis } from '@/hooks/useAutoRestoreAnalysis';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';

// skipcq: JS-0057
vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-autorestore-1';
const PASTED_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

// Same shape as useAutoRestoreAnalysis.test.tsx's RESTORE_RESPONSE, with
// one intentional difference: `analysis_payload` is `{}` here (reduced)
// vs. the fully-populated ANALYSIS_PAYLOAD in the sibling file. The
// resilience tests don't exercise payload-derived fields (persona, KG,
// classification, monetization) — they test the retry/timeout/recovery
// pipeline — so a reduced payload is sufficient and keeps the fixture
// focused. The main file's full payload is needed there because its
// assertions DO verify payload-derived store hydration.
const RESTORE_RESPONSE = {
  id: ANALYSIS_ID,
  videoId: VIDEO_ID,
  title: 'Auto-Restore Flow Test Video',
  channelTitle: 'Test Channel',
  analysis_markdown: '## Dimension 1\nSome content',
  analysisStatus: 'complete',
  analysis_payload: {},
  model: 'claude-haiku-4-5',
  analysisAt: '2026-08-01T00:00:00.000Z',
  detectedPersona: 'consultant',
  validation_report: null,
  streaming: null,
};

describe('useAutoRestoreAnalysis transient-failure retry (2026-09-15 incident RCA, video rDhaCLrdWHk)', () => {
  beforeEach(() => {
    // Store hygiene: without it, store state hydrated by earlier tests in
    // this file leaks into these.
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    // PR #315 review round 2 P2 (2026-09-15): moved from end-of-test-body
    // to afterEach so a failed assertion doesn't leak the global fetch
    // stub or a mounted hook into later tests (the original placement was
    // inside each test's own body after the assertions — a failing expect
    // skipped cleanup).
    vi.unstubAllGlobals();
    cleanup();
  });

  function countCheckCalls(fetchMock: ReturnType<typeof vi.fn>): number {
    return fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/analyses/check')).length;
  }

  it('retries a transient 500 from the check route and completes the restore', async () => {
    vi.useFakeTimers();
    let checkCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        checkCalls++;
        if (checkCalls === 1) {
          return Promise.resolve(new Response('{"error":"Internal server error"}', { status: 500 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'complete' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(RESTORE_RESPONSE), { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // First attempt (500) fires immediately; the first retry delay is 5s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(countCheckCalls(fetchMock)).toBe(2);
    expect(useAnalysisStore.getState().analysis?.id).toBe(ANALYSIS_ID);
    expect(useAnalysisStore.getState().status).toBe('complete');
    expect(useSynthesisNucleus.getState().analysis?.id).toBe(ANALYSIS_ID);

    unmount();
    vi.unstubAllGlobals();
  });

  it('does not retry a 401 from the check route (permanent by nature)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(new Response('{"error":"Unauthorized"}', { status: 401 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // Advance past ALL retry delays — a 4xx must have ended the cycle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(countCheckCalls(fetchMock)).toBe(1);
    expect(useAnalysisStore.getState().analysis?.id).toBeUndefined();

    unmount();
    vi.unstubAllGlobals();
  });

  it('a check fetch that never settles enters the retry schedule via the request timeout (P0b, PR #313 post-merge review)', async () => {
    // Pre-fix, a stalled-but-never-rejecting check fetch blocked the await
    // forever, pinning `restoring` — which ALSO blocked the online-event
    // recovery (gated on it) — so the bounded retry driver never ran. The
    // AbortController timeout must convert the hang into a 'retryable'
    // outcome on the same schedule.
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        // Stalled connection: never settles on its own, only rejects when
        // the hook's AbortController fires.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        });
      }
      if (url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify(RESTORE_RESPONSE), { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // Attempt 1: timeout abort at 10s -> 5s retry wait -> attempt 2 at ~15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    expect(countCheckCalls(fetchMock)).toBe(2);

    unmount();
    vi.unstubAllGlobals();
  });

  it('re-arms a full retry cycle on the online event after the bounded delays exhausted during a long outage', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(new Response('{"error":"Internal server error"}', { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // Exhaust the bounded budget: 1 attempt + 3 retries at 5s/15s/60s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    const checksAfterExhaustion = countCheckCalls(fetchMock);
    expect(checksAfterExhaustion).toBe(4);

    // Network returns: exactly one more attempt — bounded by the real
    // offline->online transition, not a poll loop.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(countCheckCalls(fetchMock)).toBe(checksAfterExhaustion + 1);

    unmount();
    vi.unstubAllGlobals();
  });

  it('P0-1: a check fetch whose HEADERS arrive but whose body (.json()) never settles is aborted by the timeout and enters the retry schedule', async () => {
    // The body-level timeout gap: the old helper cleared the timer once
    // headers arrived, leaving a stalled .json() uncovered. The callback
    // shape keeps the timer armed through body consumption — a stalled
    // .json() aborts on the same 10s schedule a stalled connection does.
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        const res = new Response('not-json', { status: 200 });
        res.json = () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          });
        return Promise.resolve(res);
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // Attempt 1: body timeout at 10s -> 5s retry -> attempt 2 at ~15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(countCheckCalls(fetchMock)).toBe(2);

    unmount();
    vi.unstubAllGlobals();
  });

  it('P0-1: a full-record fetch whose body (.json()) never settles is aborted by the timeout (not stuck restoring forever)', async () => {
    // The full-record fetch is the larger payload and the likelier stall.
    // A stalled .json() here must enter the retryable path, not pin
    // `restoring` forever.
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(
          new Response(JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'complete' }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
        // Full-record fetch: headers arrive, body never completes.
        const res = new Response('not-json', { status: 200 });
        res.json = () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          });
        return Promise.resolve(res);
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useAutoRestoreAnalysis(PASTED_URL));

    // Check succeeds (immediate), then full-record body stalls → timeout
    // at 10s → retryable → 5s retry wait → check+full-record again at ~15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    // At least 2 full-record attempts (the body stall was retried).
    const fullRecordCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes(`/api/analyses/${ANALYSIS_ID}`)).length;
    expect(fullRecordCalls).toBeGreaterThanOrEqual(2);

    unmount();
    vi.unstubAllGlobals();
  });
});
