/**
 * Regression coverage for ADR 021 Phase 4 (2026-09-09): useSSEStream.ts had
 * NO dedicated test file at all before this -- a pre-existing gap, made
 * worse by the fact that this hook is exactly where the fix landed (one
 * inline retry per bundle, plus ABORT_ON_PARTIAL_FAILURE flipped false so an
 * exhausted-retry bundle no longer kills the other in-flight bundles). This
 * file exists to lock that specific behavior in, not to be full hook
 * coverage -- the happy-path cache-hit/prep-bouncer flow is exercised
 * incidentally by every other integration test that calls startAnalysis, but
 * the multi-bundle retry/partial-settle logic had zero coverage anywhere.
 *
 * Follows the renderHook + fetch-router pattern from
 * useAutoRestoreAnalysis.test.tsx (real Zustand stores, real hook, no
 * extracted-logic shortcuts -- the behavior under test IS the closure
 * timing between runSingleStream/handleBundleFailure/checkSettleState).
 *
 * Forces STREAM_BUNDLES down to 2 single-dimension bundles via a mocked
 * useAdminSettings so each test only has to script 2 worker fetches instead
 * of the real 5 -- the retry/no-abort logic is bundle-count-agnostic.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor, act } from '@testing-library/react';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { useChaptersStore } from '@/store/useChaptersStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAdminSettings } from '@/lib/stores/settings-context';

vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-partial-failure-1';
const WORKER_URL = 'https://worker.test/analyze-llm-stream';
const YT_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const PREP_JOB = {
  analysisId: ANALYSIS_ID,
  id: ANALYSIS_ID,
  videoId: VIDEO_ID,
  title: 'Partial Failure Test Video',
  status: 'processing',
  metadata: { title: 'Partial Failure Test Video' },
  stream: { url: WORKER_URL, sig: 'sig', exp: 9999999999 },
  userId: 'user-1',
  transcript: 'transcript text',
};

function sseResponse(fragments: Record<string, unknown>[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of fragments) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

// The wire schema is .strict() (synthesis.ts's validators) -- no extra
// fields allowed on a 'complete' fragment.
function completeFragmentPayload() {
  return { type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID };
}

function chunkIndexFromBody(init?: RequestInit): number | undefined {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(init.body as string).chunkIndex;
  } catch {
    return undefined;
  }
}

describe('useSSEStream bundle-level retry and partial-failure settlement (ADR 021 Phase 4)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
    useChaptersStore.getState().reset(VIDEO_ID);
    vi.mocked(useAdminSettings).mockReturnValue({
      streamBundles: [{ dimensions: [1] }, { dimensions: [2] }],
      abortOnPartialFailure: undefined,
    } as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries a bundle once after a transient failure and still settles complete', async () => {
    let bundle1Attempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(PREP_JOB), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) {
          bundle1Attempts++;
          if (bundle1Attempts === 1) {
            return Promise.resolve(new Response('worker overloaded', { status: 503 }));
          }
          return Promise.resolve(sseResponse([completeFragmentPayload()]));
        }
        // bundle 2: succeeds first try
        return Promise.resolve(sseResponse([completeFragmentPayload()]));
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());

    await act(async () => {
      await result.current.startAnalysis(YT_URL, 'UTC');
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });

    // Bundle 1 was called exactly twice (initial failure + one retry), not
    // a second time beyond that -- proves the retry is bounded to one.
    expect(bundle1Attempts).toBe(2);
  });

  it('does not abort the other bundle when one bundle exhausts its retry (ABORT_ON_PARTIAL_FAILURE=false)', async () => {
    let bundle1Attempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(PREP_JOB), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) {
          bundle1Attempts++;
          // Fails BOTH the initial attempt and the retry -- exhausted.
          return Promise.resolve(new Response('worker overloaded', { status: 503 }));
        }
        // bundle 2 succeeds and must be allowed to complete even though
        // bundle 1 is permanently failing -- the regression this test guards.
        return Promise.resolve(sseResponse([completeFragmentPayload()]));
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());

    await act(async () => {
      await result.current.startAnalysis(YT_URL, 'UTC');
    });

    // Before this fix, bundle 1's first failure would have called
    // settleAnalysis('error') immediately, aborting bundle 2's in-flight
    // fetch and never reaching 'complete' at all.
    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });
    expect(bundle1Attempts).toBe(2); // initial + one retry, then gave up
  });

  it('still settles error when every bundle fails outright (baseline preserved)', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(PREP_JOB), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        return Promise.resolve(new Response('worker down', { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());

    await act(async () => {
      await result.current.startAnalysis(YT_URL, 'UTC');
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('error');
    }, { timeout: 3000 });
  });
});
