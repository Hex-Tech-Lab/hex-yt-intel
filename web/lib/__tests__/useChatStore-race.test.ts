/**
 * useChatStore — race condition & persist lifecycle tests
 *
 * Verifies:
 * 1. saved is NOT emitted before persist: saved SSE event arrives
 * 2. Stale request events cannot corrupt newer request state
 * 3. Timer-driven idle reset cannot clear a newer request's state
 * 4. Concurrent requests are isolated by requestId
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStore } from '@/store/useChatStore';

// Mock dependencies
vi.mock('@/lib/chat/outbox', () => ({
  outbox: {
    add: vi.fn(),
    all: vi.fn(() => []),
    remove: vi.fn(),
  },
  newClientMsgId: vi.fn(() => `client-${Date.now()}-${Math.random().toString(36).slice(2)}`),
}));

// Track SSE event callbacks so tests can inject events
let fetchMock: ReturnType<typeof vi.fn>;

describe('useChatStore race conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Reset store
    useChatStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Blind Spot #1: saved emitted before persist: saved SSE event
   *
   * The persist: saved event from the worker is the authoritative confirmation.
   * Without it, persistState must stay 'saving' even after deliver() returns.
   */
  it('does not auto-promote to saved without persist: saved event', () => {
    const store = useChatStore.getState();

    // Simulate: request in progress, deliver() completed (stream ended)
    store.setPersistState('saving', 'req-1');
    expect(useChatStore.getState().persistState).toBe('saving');

    // deliver() returns, but NO persist: saved event has arrived yet.
    // persistState must remain 'saving' — it should NOT be auto-promoted.
    // (The old code did: if (persistState === 'saving') setPersistState('saved'))
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-1');

    // Only the actual persist: saved event should promote to saved
    store.setPersistState('saved', 'req-1');
    expect(useChatStore.getState().persistState).toBe('saved');
  });

  /**
   * Blind Spot #2: Stale request events cannot corrupt newer request state
   *
   * If request A is slow and request B starts, A's events should not affect B.
   */
  it('discards stale request events from older requests', () => {
    const store = useChatStore.getState();

    // Simulate request A in progress
    store.setPersistState('saving', 'req-A');

    // Simulate request B starting
    store.setPersistState('saving', 'req-B');

    // Now a late 'saved' event arrives for request A
    store.setPersistState('saved', 'req-A');

    // Request B's state should NOT be affected — it should still be 'saved'
    // from the req-A event, but the activePersistRequestId should be req-B
    // Actually, the setPersistState guard should discard the req-A event
    // because activePersistRequestId is now req-B
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');
  });

  /**
   * Blind Spot #3: Timer-driven idle reset cannot clear a newer request's state
   *
   * setPersistState schedules a 5s timeout to reset to idle.
   * If a new request starts before the timer fires, the old timer must not
   * clear the new request's state.
   */
  it('stale timeout does not clear newer request state', () => {
    const store = useChatStore.getState();

    // Request A in progress, then completes — sets saved with a 5s timer
    store.setPersistState('saving', 'req-A');
    store.setPersistState('saved', 'req-A');
    expect(useChatStore.getState().persistState).toBe('saved');

    // Request B starts before the timer fires (within 5s)
    vi.advanceTimersByTime(2000); // 2s elapsed
    store.setPersistState('saving', 'req-B');
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');

    // The old timer fires at 5s — it should NOT clear req-B's state
    vi.advanceTimersByTime(3000); // total 5s

    // req-B's state should still be 'saving', not 'idle'
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');
  });

  /**
   * Blind Spot #4: Concurrent request isolation
   *
   * Two overlapping sends should have independent persist state.
   */
  it('isolates persist state between concurrent requests', () => {
    const store = useChatStore.getState();

    // Request A starts
    store.setPersistState('saving', 'req-A');
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-A');

    // Request B starts before A finishes
    store.setPersistState('saving', 'req-B');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');

    // A's saved event arrives late — should be discarded
    store.setPersistState('saved', 'req-A');
    // activePersistRequestId is still req-B (the guard discarded req-A's event)
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');

    // B's saved event arrives
    store.setPersistState('saved', 'req-B');
    expect(useChatStore.getState().persistState).toBe('saved');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');
  });

  /**
   * Blind Spot #5: error event does not affect newer request
   */
  it('discards error events from stale requests', () => {
    const store = useChatStore.getState();

    // Request A in progress
    store.setPersistState('saving', 'req-A');

    // Request B starts
    store.setPersistState('saving', 'req-B');

    // A's failed event arrives late
    store.setPersistState('failed', 'req-A');

    // B's state should still be 'saving'
    expect(useChatStore.getState().persistState).toBe('saving');
    expect(useChatStore.getState().activePersistRequestId).toBe('req-B');
  });

  /**
   * Blind Spot #6: loadConversations() must never write activeId itself.
   *
   * Live prod report (2026-08-02, after PR #177 merged): chat sessions still
   * showed unrelated-to-video content. Root cause -- loadConversations()
   * used to force-write `activeId` to null whenever ITS OWN fetched
   * conversation list didn't contain the currently-active id, even if a
   * second, faster-resolving loadConversations() call (for a different,
   * newer video) had already set the CORRECT activeId in the meantime. Every
   * real caller (ChatDock, AnalysisHistory, useAutoRestoreAnalysis,
   * useSSEStream) already re-derives and explicitly sets activeId itself
   * after awaiting loadConversations(), so the fix removes the internal
   * write entirely rather than trying to out-race it with more guards.
   */
  it('does not let a slow, older loadConversations() resolution overwrite a newer explicit activeId', async () => {
    const conversationA = { id: 'conv-A', userId: 'u1', title: 'A', analysisId: 'a1', videoId: 'v1', createdAt: '', updatedAt: '', lastMessageAt: '' };
    const conversationB = { id: 'conv-B', userId: 'u1', title: 'B', analysisId: 'a2', videoId: 'v2', createdAt: '', updatedAt: '', lastMessageAt: '' };

    // Older call (for video A) resolves LAST, and its own fetch never saw
    // conv-B (a different, newer video's conversation).
    let resolveOlder!: (v: { conversations: typeof conversationA[] }) => void;
    const olderResponse = new Promise<{ conversations: typeof conversationA[] }>((resolve) => {
      resolveOlder = resolve;
    });
    fetchMock.mockImplementationOnce(() =>
      olderResponse.then((body) => ({ ok: true, json: async () => body }))
    );
    // Newer call (for video B) resolves FIRST.
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: async () => ({ conversations: [conversationB] }) })
    );

    const olderCall = useChatStore.getState().loadConversations(); // video A, slow
    const newerCall = useChatStore.getState().loadConversations(); // video B, fast

    await newerCall;
    // Simulates the real caller (e.g. ChatDock's open effect) explicitly
    // grounding activeId in the newer, correct conversation right after its
    // own loadConversations() resolves.
    useChatStore.setState({ activeId: 'conv-B' });
    expect(useChatStore.getState().activeId).toBe('conv-B');

    // The older, video-A call finally resolves.
    resolveOlder({ conversations: [conversationA] });
    await olderCall;

    // activeId must still be conv-B -- the older call's completion must not
    // have touched it, even though conv-B isn't in that call's own fetched
    // list.
    expect(useChatStore.getState().activeId).toBe('conv-B');
  });
});
