/**
 * Prompt-cache warm stagger (2026-09-25; release condition fixed 2026-09-26):
 * Anthropic only makes a cache entry readable once the FIRST request's
 * response begins streaming. useSSEStream starts bundle 0 immediately and
 * holds bundles 1..n until bundle 0's CACHEABLE LLM request has actually
 * begun -- signaled by the worker's explicit `stage: 'llm-started'` status
 * frame or the first LLM delta -- but never longer than
 * analysis.llmCascade.cacheWarmTimeoutMs (bounded wait, never a hard gate),
 * and skips the wait entirely when prompt caching is disabled.
 * Early frames like the pre-transcript `extracting` status must NOT release
 * the gate (they arrive before the cache write starts).
 *
 * Reuses the renderHook + fetch-router harness from
 * useSSEStream-partial-failure.test.tsx (real hook, real stores, 2-bundle
 * config via mocked useAdminSettings).
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
import type { AdminSettings } from '@/lib/types/settings';

vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-cache-stagger-1';
const WORKER_URL = 'https://worker.test/analyze-llm-stream';
const YT_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

function makeJob(extra: Record<string, unknown> = {}) {
  return {
    analysisId: ANALYSIS_ID,
    id: ANALYSIS_ID,
    videoId: VIDEO_ID,
    title: 'Cache Stagger Test Video',
    status: 'processing',
    metadata: { title: 'Cache Stagger Test Video' },
    stream: { url: WORKER_URL, sig: 'sig', exp: 9999999999 },
    userId: 'user-1',
    transcript: 'transcript text',
    promptCaching: true,
    cacheWarmTimeoutMs: 8000,
    ...extra,
  };
}

function chunkIndexFromBody(init?: RequestInit): number | undefined {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(init.body as string).chunkIndex;
  } catch {
    return undefined;
  }
}

// Bundle 0 sends the early `extracting` status frame IMMEDIATELY (before the
// cacheable LLM request starts), then withholds the `llm-started` signal
// until `release` resolves -- simulating transcript extraction + OpenRouter
// connection + TTFB before the cache write commits.
function gatedBundle1Response(release: Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', stage: 'extracting', videoId: VIDEO_ID })}\n\n`));
      await release;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', stage: 'llm-started', videoId: VIDEO_ID })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID })}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function immediateCompleteResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID })}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('useSSEStream prompt-cache warm stagger', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
    useChaptersStore.getState().reset(VIDEO_ID);
    vi.mocked(useAdminSettings).mockReturnValue({
      streamBundles: [{ dimensions: [1] }, { dimensions: [2] }],
      abortOnPartialFailure: undefined,
    } as unknown as AdminSettings);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('holds bundle 2 until bundle 1 emits its LLM-start signal (not the extracting frame)', async () => {
    let releaseBundle1!: () => void;
    const bundle1Gate = new Promise<void>((resolve) => { releaseBundle1 = resolve; });
    const bundle2FetchTime: number[] = [];
    const bundle1LlmStartTime: number[] = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) {
          // Record when bundle 1's llm-started frame actually LEAVES the mock worker.
          bundle1LlmStartTime.push(Date.now());
          return Promise.resolve(gatedBundle1Response(bundle1Gate));
        }
        bundle2FetchTime.push(Date.now());
        return Promise.resolve(immediateCompleteResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());
    await act(async () => {
      const analysisPromise = result.current.startAnalysis(YT_URL, 'UTC');
      // Bundle 1 has already streamed its `extracting` frame by now -- the
      // gate must still be held (negative control for the 2026-09-26 bug:
      // releasing on the first raw byte / extracting frame).
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(bundle2FetchTime).toHaveLength(0);
      releaseBundle1();
      await analysisPromise;
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });

    expect(bundle1LlmStartTime).toHaveLength(1);
    expect(bundle2FetchTime).toHaveLength(1);
    expect(bundle2FetchTime[0]!).toBeGreaterThanOrEqual(bundle1LlmStartTime[0]! - 5);
  });

  it('starts bundles after the bounded wait when bundle 1 never streams a byte (timeout fallback)', async () => {
    // Bundle 1 streams its early `extracting` frame but never emits an
    // llm-started signal or delta (LLM request stalled pre-TTFB, 600ms); the
    // stagger must start bundle 2 at the timeout fallback (150ms), not wait
    // for it. Bundle 1 still completes afterward so the analysis settles.
    const neverResolved = new Promise<void>((resolve) => setTimeout(resolve, 600));
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ cacheWarmTimeoutMs: 150 })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) return Promise.resolve(gatedBundle1Response(neverResolved));
        return Promise.resolve(immediateCompleteResponse());
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
    }, { timeout: 4000 });
  });

  it('releases the gate on the first LLM delta when the worker sends no llm-started frame (stale worker)', async () => {
    const bundle2FetchTime: number[] = [];
    let releaseBundle1!: () => void;
    const bundle1Gate = new Promise<void>((resolve) => { releaseBundle1 = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ cacheWarmTimeoutMs: 8000 })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) {
          // Stale worker: early extracting frame, then only a delta on release.
          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', stage: 'extracting', videoId: VIDEO_ID })}\n\n`));
              await bundle1Gate;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: '{"dimension":1,' })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID })}\n\n`));
              controller.close();
            },
          });
          return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        }
                bundle2FetchTime.push(Date.now());
        return Promise.resolve(immediateCompleteResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());
    await act(async () => {
      const analysisPromise = result.current.startAnalysis(YT_URL, 'UTC');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(bundle2FetchTime).toHaveLength(0);
      releaseBundle1();
      await analysisPromise;
    });
    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });
    expect(bundle2FetchTime).toHaveLength(1);
  });

  it('does not stagger at all when prompt caching is disabled', async () => {
    const bundle2FetchTime: number[] = [];
    let releaseBundle1!: () => void;
    const bundle1Gate = new Promise<void>((resolve) => { releaseBundle1 = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ promptCaching: false, cacheWarmTimeoutMs: 5000 })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) return Promise.resolve(gatedBundle1Response(bundle1Gate));
        bundle2FetchTime.push(Date.now());
        return Promise.resolve(immediateCompleteResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());
    await act(async () => {
      const analysisPromise = result.current.startAnalysis(YT_URL, 'UTC');
      // No cache to warm: bundle 2 must not be gated on bundle 1's first byte.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(bundle2FetchTime.length).toBeGreaterThan(0);
      releaseBundle1();
      await analysisPromise;
    });
    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });
  });
});