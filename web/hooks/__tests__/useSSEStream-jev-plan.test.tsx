/**
 * R3b 2.3 (P1): client-side consumption of the Jev plan (ADR 029 v2 relay).
 *
 * useSSEStream must:
 * 1. Prefer job.jevPlan (server-computed, safeParse-validated) when present.
 * 2. Fall back to the first valid worker SSE `event: plan` frame otherwise.
 * 3. Forward the resolved plan as `jevPlan` in EVERY stream request body.
 * 4. NEVER change dispatch count: K=1 and K>1 both dispatch exactly today's
 *    K=1-equivalent partition (TOTAL_STREAMS streams); K>1 only warns.
 *
 * Reuses the renderHook + fetch-router harness from
 * useSSEStream-cache-stagger.test.tsx (real hook, real stores, 5-bundle
 * registry config via mocked useAdminSettings).
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
import { STREAM_BUNDLES } from '@/lib/config/synthesis';
import type { AdminSettings } from '@/lib/types/settings';
import type { JevPlanEvent } from '@/lib/types/contracts';

vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-jev-plan-1';
const WORKER_URL = 'https://worker.test/analyze-llm-stream';
const YT_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

function makePlan(planK: number): JevPlanEvent {
  return {
    K: planK,
    streamCount: planK * 5,
    cells: [
      { jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 100, sha256: 'a'.repeat(64) },
      { jevChunkIndex: 0, chunkIndex: 2, startWord: 0, endWord: 100, sha256: 'b'.repeat(64) },
      { jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 100, sha256: 'c'.repeat(64) },
    ],
    truncatedFallback: false,
  };
}

function makeJob(extra: Record<string, unknown> = {}) {
  return {
    analysisId: ANALYSIS_ID,
    id: ANALYSIS_ID,
    videoId: VIDEO_ID,
    title: 'Jev Plan Test Video',
    status: 'processing',
    metadata: { title: 'Jev Plan Test Video' },
    stream: { url: WORKER_URL, sig: 'sig', exp: 9999999999 },
    streamBundles: [[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]],
    userId: 'user-1',
    transcript: 'transcript text',
    ...extra,
  };
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(f));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

// Exact worker envelope from worker/src/routes/analysis.ts sendPlanEvent (#392).
function planFrame(plan: JevPlanEvent): string {
  return `event: plan\ndata: ${JSON.stringify({ v: 1, source: 'worker', ...plan })}\n\n`;
}

function completeFrame(): string {
  return `data: ${JSON.stringify({ type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID })}\n\n`;
}

const COMPLETE_RESPONSE = () => sseResponse([completeFrame()]);

function bodiesOf(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([input]) => String(input) === WORKER_URL)
    .map(([, init]) => init as RequestInit)
    .filter((init) => typeof init?.body === 'string' && (init.body as string).includes('chunkIndex'))
    .map((init) => JSON.parse(init.body as string) as Record<string, unknown>);
}

describe('useSSEStream Jev plan consumption (R3b 2.3, P1)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
    useChaptersStore.getState().reset(VIDEO_ID);
    vi.mocked(useAdminSettings).mockReturnValue({
      streamBundles: STREAM_BUNDLES.map(d => ({ dimensions: d })),
      abortOnPartialFailure: undefined,
    } as unknown as AdminSettings);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves job.jevPlan (K=1) and forwards it in all 5 stream requests', async () => {
    const jobPlan = { ...makePlan(1), estimateCents: 42 };
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ jevPlan: jobPlan })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) return Promise.resolve(COMPLETE_RESPONSE());
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

    const bodies = bodiesOf(fetchMock);
    expect(bodies).toHaveLength(5);
    expect(result.current.plan).toEqual(jobPlan);
    expect(result.current.planSource).toBe('job');
    for (const body of bodies) {
      expect(body.jevPlan).toEqual(jobPlan);
    }
  });

  it('falls back to the first valid SSE plan event when job.jevPlan is absent (K=1)', async () => {
    // Deterministic ordering via the warm-stagger gate: bundle 0's stream
    // emits the plan frame BEFORE its `llm-started` frame, and readSseBody
    // processes frames in order — so the plan is captured before bundles 2-5
    // are released for dispatch. Bundle 0's own request necessarily went out
    // before the plan existed (mid-stream capture cannot retroactively
    // rewrite an already-sent request body).
    const streamPlan = makePlan(1);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ promptCaching: true, cacheWarmTimeoutMs: 5000 })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        const body = JSON.parse((init?.body as string) || '{}') as { chunkIndex?: number };
        if (body.chunkIndex === 1) {
          return Promise.resolve(sseResponse([
            planFrame(streamPlan),
            `data: ${JSON.stringify({ type: 'status', stage: 'llm-started' })}\n\n`,
            completeFrame(),
          ]));
        }
        return Promise.resolve(COMPLETE_RESPONSE());
      }
      return Promise.resolve(new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error');

    const { result } = renderHook(() => useSSEStream());
    await act(async () => {
      await result.current.startAnalysis(YT_URL, 'UTC');
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('complete');
    }, { timeout: 3000 });

    expect(result.current.plan).toMatchObject(streamPlan);
    expect(result.current.planSource).toBe('stream');
    // Live-caught 2026-10-02: the named plan frame was also fed to the fragment
    // adapter, logging "[Adapter] JSON parse failed" once per stream.
    expect(errorSpy.mock.calls.filter((call) => String(call[0]).includes('JSON parse failed'))).toEqual([]);
    errorSpy.mockRestore();
    const bodies = bodiesOf(fetchMock);
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      const chunkIndex = body.chunkIndex as number;
      if (chunkIndex === 1) {
        expect(body.jevPlan).toBeUndefined();
      } else {
        expect(body.jevPlan).toMatchObject(streamPlan);
      }
    }
  });

  it('K>1 plan with no usable /stream-tokens response falls back to exactly 5 streams and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const k3Plan = makePlan(3);
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ jevPlan: k3Plan })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) return Promise.resolve(COMPLETE_RESPONSE());
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

    const bodies = bodiesOf(fetchMock);
    expect(bodies).toHaveLength(5);
    expect(result.current.plan).toEqual(k3Plan);
    expect(result.current.planSource).toBe('job');
    const warned = warnSpy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes('jev K>1: stream-tokens unavailable; dispatching K=1'));
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('malformed job.jevPlan and no stream plan event ⇒ K=1 (no jevPlan forwarded, plan null)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob({ jevPlan: { K: 'not-a-number' } })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) return Promise.resolve(COMPLETE_RESPONSE());
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

    const bodies = bodiesOf(fetchMock);
    expect(bodies).toHaveLength(5);
    expect(result.current.plan).toBeNull();
    expect(result.current.planSource).toBeNull();
    for (const body of bodies) {
      expect('jevPlan' in body ? body.jevPlan : undefined).toBeUndefined();
    }
    warnSpy.mockRestore();
  });

  it('NEGATIVE CONTROL: malformed plan events and non-plan event frames are never adopted as the plan', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/analyses') {
        return Promise.resolve(new Response(JSON.stringify(makeJob()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url === WORKER_URL) {
        return Promise.resolve(sseResponse([
          // malformed data payload under event: plan
          'event: plan\ndata: {"K":"bogus"}\n\n',
          // a complete fragment disguised with event: plan but wrong shape
          'event: plan\ndata: {"type":"complete"}\n\n',
          // a data-only frame (no event: line) -- must NOT be treated as a plan
          `data: ${JSON.stringify(makePlan(9))}\n\n`,
          completeFrame(),
        ]));
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

    expect(result.current.plan).toBeNull();
    expect(result.current.planSource).toBeNull();
    const bodies = bodiesOf(fetchMock);
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect('jevPlan' in body ? body.jevPlan : undefined).toBeUndefined();
    }
  });
});
