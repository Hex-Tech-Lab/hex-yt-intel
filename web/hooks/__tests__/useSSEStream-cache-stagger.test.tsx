/**
 * Prompt-cache warm stagger (2026-09-25): Anthropic only makes a cache entry
 * readable once the FIRST request's response begins streaming. useSSEStream
 * starts bundle 0 immediately and holds bundles 1..n until bundle 0's first
 * streamed byte -- but never longer than analysis.llmCascade.cacheWarmTimeoutMs
 * (bounded wait, never a hard gate), and skips the wait entirely when prompt
 * caching is disabled.
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

// Bundle 0's first byte is withheld until `release` resolves -- simulating
// OpenRouter/Anthropic connection + TTFB before the cache write commits.
function deferredFirstByteResponse(release: Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await release;
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

  it('holds bundle 2 until bundle 1 emits its first streamed byte', async () => {
    let releaseBundle1!: () => void;
    const bundle1Gate = new Promise<void>((resolve) => { releaseBundle1 = resolve; });
    const bundle2FetchTime: number[] = [];
    const bundle1FirstByteTime: number[] = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) {
          // Record when bundle 1's first byte actually LEAVES the mock worker.
          bundle1FirstByteTime.push(Date.now());
          return Promise.resolve(deferredFirstByteResponse(bundle1Gate));
        }
        bundle2FetchTime.push(Date.now());
        return Promise.resolve(immediateCompleteResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());
    let started = false;
    await act(async () => {
      const p = result.current.startAnalysis(YT_URL, 'UTC');
      // Give bundle 1 a moment to fetch -- bundle 2 must still be gated.
      await new Promise((r) => setTimeout(r, 100));
      expect(bundle2FetchTime).toHaveLength(0);
      releaseBundle1();
      await p;
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });

    expect(bundle1FirstByteTime).toHaveLength(1);
    expect(bundle2FetchTime).toHaveLength(1);
    expect(bundle2FetchTime[0]!).toBeGreaterThanOrEqual(bundle1FirstByteTime[0]! - 5);
  });

  it('starts bundles after the bounded wait when bundle 1 never streams a byte (timeout fallback)', async () => {
    // Bundle 1's first byte arrives late (600ms, well past the 150ms
    // fallback); the stagger must start bundle 2 at the timeout, not wait
    // for it. Bundle 1 still completes afterward so the analysis settles.
    const neverResolved = new Promise<void>((resolve) => setTimeout(resolve, 600));
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ cacheWarmTimeoutMs: 150 })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const chunkIndex = chunkIndexFromBody(init);
        if (chunkIndex === 1) return Promise.resolve(deferredFirstByteResponse(neverResolved));
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
        if (chunkIndex === 1) return Promise.resolve(deferredFirstByteResponse(bundle1Gate));
        bundle2FetchTime.push(Date.now());
        return Promise.resolve(immediateCompleteResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSSEStream());
    await act(async () => {
      const p = result.current.startAnalysis(YT_URL, 'UTC');
      // No cache to warm: bundle 2 must not be gated on bundle 1's first byte.
      await new Promise((r) => setTimeout(r, 100));
      expect(bundle2FetchTime.length).toBeGreaterThan(0);
      releaseBundle1();
      await p;
    });
    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });
  });
});