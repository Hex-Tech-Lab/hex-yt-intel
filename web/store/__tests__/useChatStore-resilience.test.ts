/**
 * Focused contract test for useChatStore's outbox resilience exemption
 * (PR #315 review round 2 P2, 2026-09-15; isolation rework 2026-09-18).
 *
 * useChatStore does NOT use the shared `fetchWithTimeout` helper — its
 * `deliver()` path (bouncer + stream) uses `AbortSignal.timeout()` directly,
 * and its retry mechanism is the outbox pattern (online-event replay +
 * delayed re-flush), not the bounded-retry loop the hooks use. This test
 * proves that exemption is safe: a stalled stream fetch is aborted by the
 * timeout, the error is surfaced to the user (not swallowed), and the
 * outbox retains the message for retry.
 *
 * `AbortSignal.timeout()` is backed by native timers and cannot be driven
 * by vitest fake timers (see fetch-with-timeout.ts's doc comment) — so
 * this test overrides `AbortSignal.timeout` with a controllable
 * AbortController, while class-level FAKE timers keep the failed send's
 * 3s replay timer (useChatStore.ts line ~612) from firing across tests.
 *
 * Isolation rework (PR #315 review round 2 item 4, 2026-09-18): a failed
 * send schedules a REAL 3s replay timer and bindNetwork registers an
 * UNREMOVABLE anonymous 'online' listener — both previously leaked across
 * tests (a real timer from one test could flush a later test's outbox,
 * and the online listener fired for events it was never meant to see).
 * Now: fake timers per class, the online listener is bound BEFORE any
 * failed outbox item exists, every test resets store + outbox state, and
 * the replay assertion counts fetches before/after the online event
 * specifically.
 *
 * Audit findings (2026-09-15):
 * - deliver() bouncer fetch: AbortSignal.timeout(15000) ✅
 * - deliver() stream fetch: AbortSignal.timeout(50000) ✅
 * - readSSE: 25s reader.cancel() timeout ✅
 * - Outbox retry: online event + 3s delayed re-flush ✅
 * - sending flag prevents double-sends ✅
 * - Error surfaced via `error` state + persistState:'failed' ✅
 * - GAP (not blocking, flagged for CC): the `api()` helper (line 74) used
 *   by loadConversations/newConversation/renameConversation/updateConversation
 *   AnalysisId/deleteConversation has NO timeout — a stalled REST call
 *   would hang. Not part of the outbox path, so not exempt; flagged as a
 *   separate candidate for fetchWithTimeout adoption in a future round.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStore } from '@/store/useChatStore';
import { outbox } from '@/lib/chat/outbox';

vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

const CONV_ID = 'conv-test-1';

describe('useChatStore outbox resilience exemption (PR #315 review round 2 P2)', () => {
  let originalAbortSignalTimeout: typeof AbortSignal.timeout;
  let controllers: AbortController[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    outbox.remove('nonexistent'); // no-op, ensures read path works on an empty box
    useChatStore.setState({
      conversations: [{ id: CONV_ID, title: 'Test', analysisId: null, videoId: 'vid1', createdAt: new Date().toISOString(), archived: false }],
      activeId: CONV_ID,
      messagesByConv: {},
      sending: false,
      error: null,
      persistState: 'idle',
      activePersistRequestId: null,
      // networkBound must be false so a bindNetwork() in a test registers a
      // FRESH listener for THAT test; the reset also keeps a previous
      // test's listener from being silently reused.
      networkBound: false,
    });
    controllers = [];
    originalAbortSignalTimeout = AbortSignal.timeout;
    // Override AbortSignal.timeout with a controllable controller so the
    // test can trigger the abort deterministically (native timers can't
    // be driven by vitest fake timers).
    AbortSignal.timeout = ((_ms: number) => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    }) as typeof AbortSignal.timeout;
  });

  afterEach(() => {
    AbortSignal.timeout = originalAbortSignalTimeout;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // useRealTimers DISCARDS the fake queue: the failed send's scheduled
    // 3s replay timer (and any other pending timer) can never fire into a
    // later test.
    vi.useRealTimers();
    // Full state reset — the outbox lives in localStorage and survives
    // between tests otherwise.
    localStorage.clear();
    useChatStore.getState().reset();
    useChatStore.setState({ networkBound: false, sending: false, error: null });
  });

  it('a stalled bouncer fetch is aborted by the timeout, error is surfaced, and the message stays in the outbox for retry', async () => {
    // Mock fetch to return a stalled promise (never resolves) for the
    // bouncer endpoint. The AbortSignal.timeout override gives us a
    // controller we can abort to simulate the timeout firing.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Kick off sendMessage — it will hang on the stalled bouncer fetch.
    const sendPromise = useChatStore.getState().sendMessage('test message', { analysisId: null, videoId: 'vid1' });

    // Let the microtask queue flush so deliver() starts.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // The message must be in the outbox (queued before deliver).
    expect(outbox.all().length).toBe(1);

    // Trigger the timeout abort (simulating AbortSignal.timeout(15000) firing).
    const bouncerController = controllers[0];
    bouncerController.abort();

    // Wait for the send to settle (error caught, finally clears `sending`).
    await sendPromise;

    // Error must be surfaced to the user — not swallowed.
    const state = useChatStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.sending).toBe(false);

    // The message must STAY in the outbox for retry (online event / delayed flush).
    expect(outbox.all().length).toBe(1);
  });

  it('a stalled stream fetch is aborted by the timeout, error is surfaced, and the message stays in the outbox', async () => {
    // Bouncer succeeds (returns a stream descriptor), but the stream fetch
    // itself stalls — the timeout must abort it.
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/chat/conversations/') && !url.includes('stream')) {
        // Bouncer: return a valid job descriptor with a stream URL.
        return Promise.resolve(new Response(JSON.stringify({
          stream: { url: 'https://worker.example.com/stream', sig: 'sig', exp: 0 },
          payload: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      // Stream fetch: stalled, only rejects on abort.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const sendPromise = useChatStore.getState().sendMessage('stream stall test', { analysisId: null, videoId: 'vid1' });

    // Wait for the bouncer to resolve and the stream fetch to start.
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    // The stream controller is the second one (bouncer is first).
    const streamController = controllers[1];
    streamController.abort();

    await sendPromise;

    const state = useChatStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.sending).toBe(false);
    expect(outbox.all().length).toBe(1);
  });

  it('flushOutbox on the online event replays a failed message (outbox retry mechanism is wired)', async () => {
    // Isolation contract (item 4): the online listener is bound BEFORE any
    // failed outbox item exists (bindNetwork's immediate flush is a no-op
    // on an empty box), and the failed send's 3s replay timer is FAKE —
    // never advanced — so the explicit 'online' event below is the ONLY
    // possible replay trigger. The fetch-count assertions around the event
    // prove exactly that.
    useChatStore.getState().bindNetwork();
    expect(outbox.all().length).toBe(0); // bind-time flush had nothing to replay

    // First send fails (stalled bouncer), message stays in outbox.
    const stalledFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', stalledFetch);

    const sendPromise = useChatStore.getState().sendMessage('retry me', { analysisId: null, videoId: 'vid1' });
    await vi.waitFor(() => expect(stalledFetch).toHaveBeenCalled());
    controllers[0].abort();
    await sendPromise;
    expect(outbox.all().length).toBe(1);

    // No replay has happened while still offline-failed: exactly the one
    // failed bouncer call so far, and nothing since the send settled.
    expect(stalledFetch.mock.calls.length).toBe(1);

    // Now the network recovers: replace fetch with a working bouncer + stream.
    vi.unstubAllGlobals();
    const replayFetch = vi.fn((url: string) => {
      if (url.includes('/api/chat/conversations/') && !url.includes('stream')) {
        return Promise.resolve(new Response(JSON.stringify({
          assistant: { id: 'a1', conversationId: CONV_ID, role: 'assistant', content: 'reply', createdAt: new Date().toISOString() },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', replayFetch);

    // Dispatch the online event — flushOutbox must replay.
    window.dispatchEvent(new Event('online'));

    // The outbox should be cleared (deliver succeeded, assistant returned),
    // and the replay fetch must be the ONLY fetch after the online event.
    await vi.waitFor(() => expect(outbox.all().length).toBe(0));
    expect(replayFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(stalledFetch.mock.calls.length).toBe(1); // no further attempts on the failed fetch
  });
});
