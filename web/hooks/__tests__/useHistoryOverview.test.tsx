// @vitest-environment happy-dom
//
// Fetch-race regression tests for useHistoryOverview (2026-09-26): the mount
// fetch, the 30s silent poll, and manual refetch all overlap, so an OLDER
// response resolving after a newer one must never overwrite newer data.
// Every fetch here is settled via deferred promises so resolution ORDER is
// fully controlled. These tests are the negative control for the sequence
// guard — against the pre-guard hook (no seqRef check) the out-of-order
// tests fail because the stale response clobbers the newer one.
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHistoryOverview, HISTORY_LIVE_POLL_MS } from '@/hooks/useHistoryOverview';
import type { HistoryOverviewItem } from '@/lib/ports';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okResponse(items: HistoryOverviewItem[]): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items }),
  } as unknown as Response;
}

function item(id: string, status: HistoryOverviewItem['status']): HistoryOverviewItem {
  return {
    baseVideoId: id,
    analysisId: `${id}-analysis`,
    title: `Title ${id}`,
    channelTitle: null,
    firstAnalyzedAt: '2026-09-26T00:00:00Z',
    lastAnalyzedAt: '2026-09-26T00:00:00Z',
    lastViewedAt: null,
    timesAnalyzed: 1,
    views: 0,
    bestDimensions: 0,
    presentDimensions: [],
    missingDimensions: [],
    status,
    hasDigest: false,
    hasDescription: false,
    hasChannelMeta: false,
    hasComments: false,
    hasChapters: null,
    clientPlatform: null,
  } as HistoryOverviewItem;
}

describe('useHistoryOverview fetch race (sequence guard)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('an older mount response resolving after a newer refetch is discarded (negative control: fails without the guard)', async () => {
    const mount = deferred<Response>();
    const refetched = deferred<Response>();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (call++ === 0 ? mount.promise : refetched.promise)),
    );
    const { result } = renderHook(() => useHistoryOverview());

    // Older request resolves LAST: newer refetch completes first.
    act(() => {
      void result.current.refetch();
    });
    act(() => {
      refetched.resolve(okResponse([item('new', 'complete')]));
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mount.resolve(okResponse([item('old', 'failed')]));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The stale mount response must NOT overwrite the newer refetch data.
    expect(result.current.items).toEqual([item('new', 'complete')]);
    expect(result.current.error).toBeNull();
  });

  it('a failed older request resolving after a newer success does not surface its error', async () => {
    const mount = deferred<Response>();
    const refetched = deferred<Response>();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (call++ === 0 ? mount.promise : refetched.promise)),
    );
    const { result } = renderHook(() => useHistoryOverview());

    act(() => {
      void result.current.refetch();
    });
    act(() => {
      refetched.resolve(okResponse([item('new', 'complete')]));
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mount.reject(new Error('stale failure'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([item('new', 'complete')]);
  });

  it('a silent poll error keeps the last good items and clears no state (no error surfaced)', async () => {
    const mount = deferred<Response>();
    const poll = deferred<Response>();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => (call++ === 0 ? mount.promise : poll.promise)),
    );
    const { result } = renderHook(() => useHistoryOverview());

    act(() => {
      mount.resolve(okResponse([item('live', 'processing')]));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items).toEqual([item('live', 'processing')]);

    // Poll tick fires; the poll request fails after being started.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_LIVE_POLL_MS);
    });
    expect(call).toBe(2);
    act(() => {
      poll.reject(new Error('transient network error'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([item('live', 'processing')]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
