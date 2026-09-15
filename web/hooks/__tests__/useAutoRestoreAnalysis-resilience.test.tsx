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
import { renderHook, act } from '@testing-library/react';
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

// Same shape as useAutoRestoreAnalysis.test.tsx's RESTORE_RESPONSE --
// deliberately identical so a behavior diff between the two files' fixtures
// shows up as a test-outcome diff, not a data diff.
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
});
