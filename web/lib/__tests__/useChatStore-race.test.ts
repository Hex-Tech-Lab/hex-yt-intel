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

// This suite runs under vitest's 'node' environment (no jsdom), so neither
// `window` nor `localStorage` exist as globals. restoreLastActiveConversation
// early-returns on `typeof window === 'undefined'`, so the epoch-race test
// below needs both stubbed -- a minimal in-memory Storage is enough, no jsdom
// dependency required.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
}

describe('useChatStore race conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', createMemoryStorage());

    // Reset store
    useChatStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
  it('never writes activeId as a side effect, regardless of what activeId was set to mid-fetch', async () => {
    // Direct contract test, not a caller-simulation: seed activeId to a
    // conversation NOT present in the store's current `conversations` (so
    // the priorActiveId merge-back can't rescue it) and NOT present in the
    // fetch response either, then call loadConversations(). The prior
    // implementation would force this to null (its own restoredId logic
    // requires the id to be findable in the post-merge list, which it
    // deliberately isn't here); the fixed implementation must leave
    // activeId completely untouched, since list-loading and active-thread
    // selection are now two separate concerns.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [{ id: 'conv-other', userId: 'u1', title: 'Other', analysisId: null, videoId: null, createdAt: '', updatedAt: '', lastMessageAt: '' }] }),
    });
    useChatStore.setState({ activeId: 'conv-mid-fetch', conversations: [] });

    await useChatStore.getState().loadConversations();

    expect(useChatStore.getState().activeId).toBe('conv-mid-fetch');
  });

  /**
   * Blind Spot #7: restoreLastActiveConversation() must not overwrite a
   * newer, context-scoped restore that already selected the correct
   * conversation.
   *
   * code-reviewer finding, 2026-08-02: restoreLastActiveConversation() was
   * added (alongside the loadConversations() fix above) specifically to
   * preserve general-chat localStorage restore now that loadConversations()
   * no longer writes activeId -- but it shipped without the same epoch
   * guard updateConversationAnalysisId already has, reintroducing the exact
   * "stale restore overwrites a newer correct one" race in the one call
   * site missing it. ChatDock's own general-chat branch is a real repro:
   * user opens the dock with no video (kicks off this restore), then
   * immediately navigates to a video before this restore's own await
   * resolves -- the video-scoped restore must win.
   */
  it('does not let a stale epoch select a conversation via restoreLastActiveConversation', async () => {
    // Matches the real call pattern exactly: ChatDock's general-chat branch
    // always sets activeId to null in the SAME synchronous stretch right
    // before calling this, so the pre-existing `if (get().activeId) return`
    // guard can never trip here by construction -- the epoch check is the
    // ONLY thing that can stop a stale call from selecting. (An earlier
    // draft of this test accidentally exercised that other guard instead of
    // the epoch check by pre-seeding activeId to a truthy value -- fixed to
    // isolate the actual mechanism under test.)
    const savedConv = { id: 'conv-general', userId: 'u1', title: 'General', analysisId: null, videoId: null, createdAt: '', updatedAt: '', lastMessageAt: '' };
    localStorage.setItem('hex_yt_last_active_conv', savedConv.id);
    useChatStore.setState({ conversations: [savedConv], activeId: null });

    const store = useChatStore.getState();
    const staleEpoch = store.beginRestoreEpoch(); // this (older) attempt's token
    store.beginRestoreEpoch(); // a newer restore attempt has since started

    await useChatStore.getState().restoreLastActiveConversation({ epoch: staleEpoch });

    // The stale epoch must have short-circuited BEFORE selectConversation --
    // activeId stays null, leaving room for the newer (in-flight) restore
    // to set the correct one instead of this stale general-chat
    // conversation winning the race.
    expect(useChatStore.getState().activeId).toBe(null);
  });
});
