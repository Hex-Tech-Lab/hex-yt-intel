/**
 * Regression test: the 8s "Persist state stuck at saving" watchdog must not
 * fire while the worker is still generating the reply.
 *
 * RCA (2026-10-13, T2): deliver() armed the 8s saving watchdog the moment a
 * message was sent. The worker only emits `persist: saving` AFTER the whole
 * LLM generation finishes (worker/src/chat-stream.ts, STAGE 3, inside the
 * atomicPersist persist callback). Any reply that takes more than 8s to
 * generate therefore tripped the watchdog before the persist frames could
 * exist, and the console printed "stuck at saving" on every slow send. The
 * real saved/failed frame still arrived later and was applied correctly.
 *
 * Fix under test: the watchdog is armed only when the worker's own
 * `persist: saving` frame arrives. These tests drive the real sendMessage ->
 * readSSE path with a worker-shaped SSE stream.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStore } from '@/store/useChatStore';
import { outbox } from '@/lib/chat/outbox';
import { safeLocalStorage } from '@/lib/utils/safe-storage';

vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

const CONV_ID = 'conv-watchdog-1';
const WORKER_URL = 'https://worker.test/chat-stream';
const TIMEOUT_MS = 50000;

let currentReqId = '';

function frame(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

describe('useChatStore persist watchdog (T2 RCA)', () => {
  let originalAbortSignalTimeout: typeof AbortSignal.timeout;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    safeLocalStorage.clear();
    outbox.remove('nonexistent');
    useChatStore.setState({
      conversations: [{ id: CONV_ID, title: 'Test', analysisId: null, videoId: 'vid1', createdAt: new Date().toISOString(), archived: false }],
      activeId: CONV_ID,
      messagesByConv: {},
      sending: false,
      error: null,
      persistState: 'idle',
      activePersistRequestId: null,
      networkBound: false,
    });
    streamController = null;
    originalAbortSignalTimeout = AbortSignal.timeout;
    // Native AbortSignal timers do not follow fake timers; these tests never
    // need the client timeout to fire, so give back a signal that never aborts.
    AbortSignal.timeout = (() => new AbortController().signal) as typeof AbortSignal.timeout;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    AbortSignal.timeout = originalAbortSignalTimeout;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    safeLocalStorage.clear();
    useChatStore.getState().reset();
    useChatStore.setState({ networkBound: false, sending: false, error: null });
  });

  /** Mock the Vercel bouncer (JSON job) and a worker SSE stream we control frame by frame. */
  function mockBouncerAndStream() {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/messages')) {
        currentReqId = String((JSON.parse(String(init?.body)) as { clientMsgId: string }).clientMsgId);
        return new Response(
          JSON.stringify({
            user: { id: 'u1', conversationId: CONV_ID, role: 'user', content: 'hi', createdAt: new Date().toISOString() },
            stream: { url: WORKER_URL, sig: 'sig', exp: 1 },
            payload: { timeoutMs: TIMEOUT_MS },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('does not clear to idle while the worker is still generating (no persist frame yet)', async () => {
    mockBouncerAndStream();
    const sendPromise = useChatStore.getState().sendMessage('hi', { analysisId: null, videoId: 'vid1' });

    // Generation takes 10s. The old code cleared to idle at 8s here.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('stuck at "saving"'));

    // Worker streams deltas, then persist frames, then done.
    streamController!.enqueue(frame({ type: 'delta', content: 'Answer.', requestId: currentReqId }));
    streamController!.enqueue(frame({ type: 'persist', status: 'saving', requestId: currentReqId }));
    streamController!.enqueue(frame({ type: 'persist', status: 'saved', requestId: currentReqId }));
    streamController!.enqueue(frame({ type: 'done', requestId: currentReqId }));
    streamController!.close();
    await sendPromise;

    // Assert before timers run: the post-saved 5s timer clears to idle.
    expect(useChatStore.getState().persistState).toBe('saved');
  });

  it('a worker persist:saved frame drives the state to saved, not a client-side guess', async () => {
    mockBouncerAndStream();
    const sendPromise = useChatStore.getState().sendMessage('hi', { analysisId: null, videoId: 'vid1' });
    await vi.advanceTimersByTimeAsync(0);

    streamController!.enqueue(frame({ type: 'persist', status: 'saving', requestId: currentReqId }));
    await vi.advanceTimersByTimeAsync(0);
    expect(useChatStore.getState().persistState).toBe('saving');

    streamController!.enqueue(frame({ type: 'persist', status: 'saved', requestId: currentReqId }));
    streamController!.enqueue(frame({ type: 'done', requestId: currentReqId }));
    streamController!.close();
    await sendPromise;

    expect(useChatStore.getState().persistState).toBe('saved');
  });

  it('never marks saved when the stream ends without a persist frame', async () => {
    mockBouncerAndStream();
    const sendPromise = useChatStore.getState().sendMessage('hi', { analysisId: null, videoId: 'vid1' });
    await vi.advanceTimersByTimeAsync(0);

    streamController!.enqueue(frame({ type: 'delta', content: 'partial', requestId: currentReqId }));
    streamController!.close();
    await vi.runAllTimersAsync();
    await sendPromise;

    expect(useChatStore.getState().persistState).not.toBe('saved');
    expect(useChatStore.getState().persistState).toBe('idle');
  });
});
