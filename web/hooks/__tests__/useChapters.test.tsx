/**
 * Regression test for the useChapters self-cancellation bug (2026-08-06).
 *
 * The original implementation subscribed to the whole Zustand store
 * (useChaptersStore() without a selector) and placed it in the effect's
 * dependency array. Since Zustand's set() produces a new object on every
 * call, the effect's own setLoading() call would re-trigger the effect,
 * whose cleanup cancelled the in-flight fetch -- while the second pass
 * short-circuited on status === 'loading', permanently starving the fetch.
 * This test verifies that:
 * 1. A component mount triggers a chapter fetch.
 * 2. Unmount/remount before the fetch settles does NOT leave the store
 *    entry permanently stuck at 'loading' (the cleanup resets the entry).
 * 3. reset(videoId) causes the hook to retrigger its fetch for the
 *    same videoId.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useChapters } from '@/hooks/useChapters';
import { useChaptersStore } from '@/store/useChaptersStore';

// Helper to create a minimal OK response.
function okResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useChapters remount/reset behavior', () => {
  beforeEach(() => {
    useChaptersStore.setState({ entries: {}, generations: {} });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('mount triggers a fetch, and remount before settle resets to idle (not stuck loading)', () => {
    const fetchMock = vi.fn();
    // Simulate a slow fetch that never settles during this test.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    // First mount: triggers fetch.
    const { unmount } = renderHook(() => useChapters('vid1'));
    expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loading');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Unmount before the fetch settles: cleanup should reset the entry.
    unmount();
    expect(useChaptersStore.getState().entries['vid1']).toBeUndefined();
  });

  it('remount after cleanup successfully retriggers a fetch (not blocked by handledForRef)', () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    // Mount, unmount (resets entry), mount again.
    const { unmount } = renderHook(() => useChapters('vid1'));
    unmount();
    const { unmount: unmount2 } = renderHook(() => useChapters('vid1'));
    expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loading');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount2();
  });

  it('reset(videoId) causes the hook to refetch', async () => {
    let resolvePromise: (response: Response) => void = () => {};
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount: _unmount } = renderHook(() => useChapters('vid1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Let the first fetch complete with confirmed data.
    await act(() => {
      resolvePromise(
        okResponse({ chapters: [{ idx: 0, start_seconds: 0, end_seconds: 10, label: 'Intro' }], confirmed: true })
      );
    });
    // Advance timers to let the promise chain settle.
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loaded');
    });

    // Reset via the store: bumps generation, clears entry.
    act(() => {
      useChaptersStore.getState().reset('vid1');
    });

    // Now re-mount the hook: should trigger a new fetch.
    const { unmount: unmount2 } = renderHook(() => useChapters('vid1'));
    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loading');
    });
    // The initial call (vid1), plus this new remount.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount2();
  });

  it('reset(videoId) retriggers a fetch on an ALREADY-MOUNTED hook, without unmounting -- the real production path', async () => {
    // Post-review finding (2026-08-06): the previous test above only
    // verified reset() through an unmount+remount cycle. The actual
    // production call site (web/hooks/useSSEStream.ts's startAnalysis)
    // calls useChaptersStore.getState().reset(videoId) on a re-analysis
    // WITHOUT unmounting the component that's already showing chapters for
    // that video -- this is the scenario the hook's `generation` selector
    // in its effect dependency array exists specifically to handle.
    let resolvePromise: (response: Response) => void = () => {};
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolvePromise = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useChapters('vid1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => {
      resolvePromise(
        okResponse({ chapters: [{ idx: 0, start_seconds: 0, end_seconds: 10, label: 'Intro' }], confirmed: true })
      );
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loaded');
    });

    // Reset WITHOUT unmounting the hook instance above.
    act(() => {
      useChaptersStore.getState().reset('vid1');
    });

    // The still-mounted hook should detect the generation bump and refetch
    // on its own -- no remount involved.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid1']?.status).toBe('loading');
    });

    unmount();
  });
});

describe('useChapters network-recovery refetch (2026-09-15 incident RCA, video rDhaCLrdWHk)', () => {
  beforeEach(() => {
    useChaptersStore.setState({ entries: {}, generations: {} });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it('retries exhausted during an outage re-arm a fresh fetch on the next online event', async () => {
    // All MAX_RETRIES attempts fail with a network error (the connection is
    // down) — the entry lands in 'error' permanently, exactly the incident
    // shape: ~31s of backoff against an outage that lasted ~100 minutes, so
    // the Chapters chip stayed grey for the whole session until a manual
    // refresh after the network returned.
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useChapters('vid-outage'));

    // Advance well past the full backoff schedule (1+2+4+8+16 = 31s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(useChaptersStore.getState().entries['vid-outage']?.status).toBe('error');
    const attemptsAfterError = fetchMock.mock.calls.length;
    expect(attemptsAfterError).toBe(5); // MAX_RETRIES, then permanent

    // Simulate the network returning: the hook must reset the errored
    // entry (bumping generation), which restarts its own fetch.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
    });

    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid-outage']?.status).toBe('loading');
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(attemptsAfterError);

    // A second online event while NOT in error must not spam extra fetches.
    const attemptsAfterRecovery = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(attemptsAfterRecovery);
  });

  it('a stalled chapters fetch enters the backoff loop via the request timeout (P0b, PR #313 post-merge review)', async () => {
    // Pre-fix, a stalled-but-never-rejecting fetch blocked the loop's await
    // forever: retryCount never advanced, so the backoff schedule (and the
    // online-recovery re-arm that depends on the entry reaching 'error')
    // could never run. The AbortController timeout must convert the hang
    // into a rejection — the same bucket as any network failure.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useChapters('vid-stall'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useChaptersStore.getState().entries['vid-stall']?.status).toBe('loading');

    // Attempt 1: timeout abort at 10s -> 1s backoff -> attempt 2 at ~11s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Full schedule (timeouts at 10s + backoffs 1/2/4/8s) exhausts
    // MAX_RETRIES and settles the entry at 'error' instead of hanging in
    // 'loading' forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(useChaptersStore.getState().entries['vid-stall']?.status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(5); // MAX_RETRIES
  });

  it('online event does nothing when the entry already settled (loaded)', async () => {
    let resolvePromise: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvePromise = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useChapters('vid-ok'));
    await act(() => {
      resolvePromise(okResponse({ chapters: [{ idx: 0, start_seconds: 0, end_seconds: 10, label: 'Intro' }], confirmed: true }));
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(useChaptersStore.getState().entries['vid-ok']?.status).toBe('loaded');
    });

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock.mock.calls.length).toBe(callsBefore); // no spurious refetch
  });

  it('P0-1: a chapters fetch whose body (.json()) never settles is aborted by the timeout and enters the backoff loop (not stuck loading forever)', async () => {
    // The body-level timeout gap: the old helper cleared the timer once
    // headers arrived, leaving a stalled .json() uncovered. The callback
    // shape keeps the timer armed through body consumption — a stalled
    // .json() aborts on the same 10s schedule a stalled connection does,
    // and the backoff loop advances instead of hanging in 'loading'.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const res = new Response('not-json', { status: 200 });
      res.json = () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      return Promise.resolve(res);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useChapters('vid-body-stall'));
    expect(useChaptersStore.getState().entries['vid-body-stall']?.status).toBe('loading');

    // Attempt 1: body timeout at 10s -> 1s backoff -> attempt 2 at ~11s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Full backoff schedule exhausts MAX_RETRIES and settles at 'error'
    // instead of hanging in 'loading' forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(useChaptersStore.getState().entries['vid-body-stall']?.status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(5); // MAX_RETRIES
  });
});