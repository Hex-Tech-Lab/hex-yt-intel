/**
 * R3b 2.5e: K>1 (Jev map-reduce) dispatch in useSSEStream.
 *
 * - K=1 is unchanged and never calls /stream-tokens.
 * - K=2: one token call for the 8 grounded cells, at most
 *   jevMaxParallelStreams worker requests in flight, the projective token
 *   call only after every grounded cell settled, v2 token fields in every
 *   body.
 * - Chunk 1 cells never write to the live view (progress-only).
 * - /stream-tokens 409 -> today's 5 K=1 requests.
 * - The final swap writes the reduced dimensions + partial dims, clears run.
 *
 * Same harness as useSSEStream-jev-plan.test.tsx.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor, act } from '@testing-library/react';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { useChaptersStore } from '@/store/useChaptersStore';
import { useJevRunStore } from '@/store/useJevRunStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisDimensionsStore } from '@/lib/stores/analysis-dimensions-store';
import { useAdminSettings } from '@/lib/stores/settings-context';
import { STREAM_BUNDLES } from '@/lib/config/synthesis';
import type { AdminSettings } from '@/lib/types/settings';
import type { JevPlanEvent } from '@/lib/types/contracts';

vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-jev-cells-1';
const WORKER_URL = 'https://worker.test/analyze-llm-stream';
const YT_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const BUNDLES = [[1, 10], [2, 4, 6], [5, 7], [3, 8], [9, 11]];
const TOKENS_URL = `/api/analyses/${ANALYSIS_ID}/stream-tokens`;
const RECORD_URL = `/api/analyses/${ANALYSIS_ID}`;

type Cell = { jevChunkIndex: number; chunkIndex: number };

/** K=2: chunks 1-4 grounded for jev 0 and 1 (8 cells), chunk 5 projective once. */
function makeK2Plan(): JevPlanEvent {
  const cells = [];
  for (const jevChunkIndex of [0, 1]) {
    for (const chunkIndex of [1, 2, 3, 4]) {
      cells.push({ jevChunkIndex, chunkIndex, startWord: jevChunkIndex * 100, endWord: jevChunkIndex * 100 + 100, sha256: `${jevChunkIndex}`.repeat(64) });
    }
  }
  cells.push({ jevChunkIndex: 0, chunkIndex: 5, startWord: 0, endWord: 0, sha256: 'e'.repeat(64) });
  return { K: 2, streamCount: 9, cells, truncatedFallback: false };
}

function makeJob(extra: Record<string, unknown> = {}) {
  return {
    analysisId: ANALYSIS_ID,
    id: ANALYSIS_ID,
    videoId: VIDEO_ID,
    title: 'Jev Cells Test Video',
    status: 'processing',
    metadata: { title: 'Jev Cells Test Video' },
    stream: { url: WORKER_URL, sig: 'job-sig', exp: 9999999999 },
    streamBundles: BUNDLES,
    userId: 'user-1',
    transcript: 'transcript text',
    jevMaxParallelStreams: 3,
    ...extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const completeFrame = () => frame({ type: 'complete', model: 'test-model', valid: true, videoId: VIDEO_ID, analysisId: ANALYSIS_ID });

function tokenFor(cell: Cell) {
  return {
    ...cell,
    sig: `sig-${cell.jevChunkIndex}-${cell.chunkIndex}`,
    exp: 1234,
    tokenVersion: 2,
    streamCount: 9,
    jevChunkCount: 2,
    bundleList: BUNDLES,
    sliceSha256: 'f'.repeat(64),
    startWord: 0,
    endWord: 100,
  };
}

const REDUCED = {
  analysisStatus: 'complete',
  analysis_payload: { dimensions: [{ number: 1, name: 'D1', content: 'REDUCED' }] },
  validation_report: { jev_partial_dimensions: [3] },
};

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>;
  events: string[];
  peakInFlight: () => number;
  tokenCalls: Cell[][];
  workerBodies: Array<Record<string, unknown>>;
  dim1AtFirstPoll: () => string | undefined;
}

function harness(opts: { job?: Record<string, unknown>; tokensStatus?: number; tokenTtlMs?: number } = {}): Harness {
  const events: string[] = [];
  const tokenCalls: Cell[][] = [];
  const workerBodies: Array<Record<string, unknown>> = [];
  let inFlight = 0;
  let peak = 0;
  let dim1Snapshot: string | undefined;
  let polled = false;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/analyses') return Promise.resolve(json(makeJob(opts.job)));
    if (url === TOKENS_URL) {
      const cells = (JSON.parse(String(init?.body)) as { cells: Cell[] }).cells;
      tokenCalls.push(cells);
      events.push(`tokens:${cells.map((c) => `${c.jevChunkIndex}:${c.chunkIndex}`).join(',')}`);
      if (opts.tokensStatus && opts.tokensStatus !== 200) return Promise.resolve(json({ error: 'plan_k1' }, opts.tokensStatus));
      const exp = Date.now() + (opts.tokenTtlMs ?? 120_000);
      return Promise.resolve(json({ tokens: cells.map((cell) => ({ ...tokenFor(cell), exp })) }));
    }
    if (url === WORKER_URL) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      workerBodies.push(body);
      if (opts.tokenTtlMs !== undefined && Date.now() > (body.exp as number)) {
        events.push(`expired:${body.jevChunkIndex}:${body.chunkIndex}`);
        return Promise.resolve(new Response('token expired', { status: 401 }));
      }
      const id = `${body.jevChunkIndex ?? 'v1'}:${body.chunkIndex}`;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      events.push(`start:${id}`);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          events.push(`end:${id}`);
          const frames = body.chunkIndex === 1 ? [frame({ type: 'dimension', dimension: 1, name: 'D1', content: `CHUNK${body.jevChunkIndex ?? 0} live dimension text` })] : [];
          resolve(sseResponse([...frames, completeFrame()]));
        }, 5);
      });
    }
    if (url === `/api/analyses/${ANALYSIS_ID}/projective-context`) {
      events.push('projective-context');
      return Promise.resolve(json({ prior_payload: { schemaVersion: '2.0', dimensions: [] }, contextSig: 'ctx', contextExp: 1 }));
    }
    if (url === RECORD_URL) {
      if (!polled) {
        polled = true;
        dim1Snapshot = useAnalysisDimensionsStore.getState().getDimension(1)?.content;
      }
      events.push('poll');
      return Promise.resolve(json(REDUCED));
    }
    return Promise.resolve(json({ conversations: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, events, peakInFlight: () => peak, tokenCalls, workerBodies, dim1AtFirstPoll: () => dim1Snapshot };
}

async function runAnalysis() {
  const { result } = renderHook(() => useSSEStream());
  await act(async () => {
    await result.current.startAnalysis(YT_URL, 'UTC');
  });
  await waitFor(() => {
    expect(useAnalysisStore.getState().status).toBe('complete');
  }, { timeout: 5000 });
  return result;
}

describe('useSSEStream K>1 cell dispatch (R3b 2.5e)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
    useChaptersStore.getState().reset(VIDEO_ID);
    useJevRunStore.getState().clear();
    vi.mocked(useAdminSettings).mockReturnValue({
      streamBundles: STREAM_BUNDLES.map((d) => ({ dimensions: d })),
      abortOnPartialFailure: undefined,
    } as unknown as AdminSettings);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('K=1 plan: today\'s 5 v1 requests, no /stream-tokens call', async () => {
    const mock = harness({ job: { jevPlan: { K: 1, streamCount: 5, cells: [], truncatedFallback: false } } });
    await runAnalysis();
    expect(mock.tokenCalls).toHaveLength(0);
    expect(mock.workerBodies).toHaveLength(5);
    expect(mock.workerBodies.every((b) => b.tokenVersion === undefined && b.sig === 'job-sig')).toBe(true);
    expect(useJevRunStore.getState().run).toBeNull();
  });

  it('K=2: grounded cells under the cap, projective only after every grounded cell settled, v2 fields in every body', async () => {
    const mock = harness({ job: { jevPlan: makeK2Plan() } });
    await runAnalysis();

    expect(mock.tokenCalls).toHaveLength(2);
    expect(mock.tokenCalls[0]).toHaveLength(8);
    expect(mock.tokenCalls[0]?.some((c) => c.chunkIndex === 5)).toBe(false);
    expect(mock.tokenCalls[1]).toEqual([{ jevChunkIndex: 0, chunkIndex: 5 }]);

    expect(mock.workerBodies).toHaveLength(9);
    expect(mock.peakInFlight()).toBeLessThanOrEqual(3);
    expect(mock.peakInFlight()).toBeGreaterThan(1);

    const projectiveTokenAt = mock.events.findIndex((event) => event === 'tokens:0:5');
    const lastGroundedEnd = mock.events.reduce((last, event, idx) => (event.startsWith('end:') && !event.endsWith(':5') ? idx : last), -1);
    expect(projectiveTokenAt).toBeGreaterThan(lastGroundedEnd);

    for (const body of mock.workerBodies) {
      expect(body).toMatchObject({ tokenVersion: 2, streamCount: 9, totalChunks: 9, jevChunkCount: 2, bundleList: BUNDLES, sliceSha256: 'f'.repeat(64), startWord: 0, endWord: 100 });
      expect(body.sig).toBe(`sig-${body.jevChunkIndex}-${body.chunkIndex}`);
    }
  });

  it('chunk 1 cells never overwrite chunk 0\'s live view', async () => {
    const mock = harness({ job: { jevPlan: makeK2Plan() } });
    await runAnalysis();
    expect(mock.dim1AtFirstPoll()).toBe('CHUNK0 live dimension text');
  });

  it('/stream-tokens 409 -> today\'s 5 K=1 requests', async () => {
    const mock = harness({ job: { jevPlan: makeK2Plan() }, tokensStatus: 409 });
    await runAnalysis();
    expect(mock.tokenCalls).toHaveLength(1);
    expect(mock.workerBodies).toHaveLength(5);
    expect(mock.workerBodies.every((b) => b.tokenVersion === undefined && b.sig === 'job-sig')).toBe(true);
    expect(useJevRunStore.getState().run).toBeNull();
  });

  it('final swap writes the reduced dimensions and partial dims and clears run', async () => {
    harness({ job: { jevPlan: makeK2Plan() } });
    await runAnalysis();
    expect(useAnalysisDimensionsStore.getState().getDimension(1)?.content).toBe('REDUCED');
    expect(useJevRunStore.getState()).toMatchObject({ run: null, partialDimensions: [3] });
  });

  it('a queued cell never starts on an expired token (tokens outlive the wait in the queue)', async () => {
    // 15 ms TTL, >= 5 ms per cell, cap 1: cells queued behind 3+ others wait past the TTL.
    const mock = harness({ job: { jevPlan: makeK2Plan(), jevMaxParallelStreams: 1 }, tokenTtlMs: 15 });
    await runAnalysis();
    expect(mock.events.filter((event) => event.startsWith('expired:'))).toEqual([]);
  });
});
