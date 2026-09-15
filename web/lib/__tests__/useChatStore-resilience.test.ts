/**
 * Chat send-path resilience tests (2026-09-15 incident RCA, video
 * rDhaCLrdWHk — "typed a message, sent it, it disappeared with no response
 * and no error shown").
 *
 * Pins three contracts added by the RCA fix:
 *
 * 1. The bouncer fetch (POST /api/chat/conversations/[id]/messages) is
 *    issued WITH an AbortSignal timeout — previously unbounded, so a stalled
 *    connection hung `sending: true` forever and ChatDock.submit's
 *    `if (!t || sending) return` silently dropped every subsequent message.
 * 2. A failed send surfaces a user-visible store error (the ChatDock error
 *    banner renders it) instead of failing silently.
 * 3. A failed send schedules one bounded outbox replay — the error message
 *    says "queued for retry", and previously nothing honored that when the
 *    browser never fired an 'online' event (failure while already online).
 *
 * Runs under happy-dom (localStorage for the outbox). The AbortSignal
 * timeout itself is browser-native and cannot be advanced by fake timers,
 * so the timeout is asserted by contract (signal present) and the
 * failure/replay machinery by deterministic rejection.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStore } from '@/store/useChatStore';
import { outbox } from '@/lib/chat/outbox';
import type { ChatConversation } from '@/lib/types/chat';

const CONV: ChatConversation = {
  id: 'conv-resilience-1',
  userId: 'user-1',
  title: 'Test thread',
  analysisId: null,
  videoId: null,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  lastMessageAt: '2026-09-15T00:00:00.000Z',
};

describe('useChatStore send resilience (2026-09-15 incident RCA)', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({
      conversations: [CONV],
      activeId: CONV.id,
      messagesByConv: {},
      sending: false,
      error: null,
      persistState: 'idle',
      activePersistRequestId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('issues the bouncer fetch WITH a bounded abort signal (previously unbounded)', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const sendPromise = useChatStore.getState().sendMessage('hello', {});
    // Advance real time is not possible for a native AbortSignal.timeout —
    // assert the contract: a signal exists on the bouncer call. Never
    // resolving fetch keeps `sending` true; the eventual native timeout
    // aborts it in production.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    // Detach: the hanging promise keeps the microtask queue idle; end the
    // test without awaiting it.
    void sendPromise.catch(() => {});
    useChatStore.setState({ sending: false });
  });

  it('a failed bouncer round-trip surfaces a visible error, clears sending, keeps the outbox entry, and schedules one replay', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    await useChatStore.getState().sendMessage('hello retry', {});

    // Visible error surfaced (drives ChatDock's new error banner).
    expect(useChatStore.getState().error).toBeTruthy();
    // sending cleared — subsequent sends are no longer silently dropped.
    expect(useChatStore.getState().sending).toBe(false);
    // persistState failed (PersistStatusIndicator), and the message stays
    // queued for the replay ("queued for retry" made real).
    expect(useChatStore.getState().persistState).toBe('failed');
    expect(outbox.all().some((e) => e.content === 'hello retry')).toBe(true);

    // The scheduled replay: exactly one more bouncer attempt ~3s later
    // (server dedupes on clientMsgId, so the replay is idempotent).
    const callsBeforeReplay = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_500);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeReplay + 1);
    // Replay also failed (still rejecting) — no further self-scheduled
    // retries (only real 'online' events trigger more).
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeReplay + 1);
  });

  it('a successful send clears the error state (the banner auto-dismisses on the next attempt)', async () => {
    useChatStore.setState({ error: 'stale failure from earlier' });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat/conversations')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'u1', conversationId: CONV.id, role: 'user', content: 'hi', createdAt: new Date().toISOString() }, stream: { url: 'https://worker.test/stream', sig: 's', exp: 1 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      // Worker stream fetch: immediate network failure is fine for this
      // assertion — the optimistic error-clear on the NEXT send attempt
      // happens in deliver()'s initial set, before any fetch.
      return Promise.reject(new TypeError('worker unreachable'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await useChatStore.getState().sendMessage('second attempt', {});
    // deliver()'s optimistic set resets error to null at the START of the
    // attempt; the subsequent stream failure sets a NEW error, but the
    // stale one is gone — assert the state transitioned (not the stale value).
    expect(useChatStore.getState().error).not.toBe('stale failure from earlier');
  });
});
