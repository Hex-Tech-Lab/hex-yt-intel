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

  it('mount triggers a fetch, and remount before settle resets to idle (not stuck loading)', async () => {
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

  it('remount after cleanup successfully retriggers a fetch (not blocked by handledForRef)', async () => {
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
    let resolvePromise: (v: Response) => void = () => {};
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useChapters('vid1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Let the first fetch complete with confirmed data.
    await act(async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount2();
  });
});