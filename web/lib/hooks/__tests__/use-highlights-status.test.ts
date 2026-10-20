/** @vitest-environment jsdom */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useHighlightsStatus } from '../useHighlightsStatus';

describe('useHighlightsStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports null (grey) while status is not complete', () => {
    const { result } = renderHook(() => useHighlightsStatus('a1', 'processing'));
    expect(result.current).toEqual({ hasHighlights: null, count: 0 });
  });

  it('reports true with count on a non-empty response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}, {}] }) })
    );
    const { result } = renderHook(() => useHighlightsStatus('a1', 'complete'));
    await waitFor(() => expect(result.current.hasHighlights).toBe(true));
    expect(result.current.count).toBe(3);
  });

  it('does not immediately commit to false on an empty response -- retries with backoff first (finalization-race protection)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useHighlightsStatus('a1', 'complete'));

    // Attempt 0: fires immediately
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.hasHighlights).toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Attempt 1: at 3000ms (+2950ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 2: at 6000ms (+3000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 3: at 10000ms (+4000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 4: at 15000ms (+5000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 5: at 25000ms (+10000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 6: at 35000ms (+10000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(result.current.hasHighlights).toBe(null);

    // Attempt 7: at 45000ms (+10000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(result.current).toEqual({ hasHighlights: false, count: 0 });
  });

  it('re-triggers the fetch cycle when digestLoading transitions to false, even after the retry budget was FULLY exhausted', async () => {
    // Real production race (2026-09-08, live DB verification): highlights
    // are backfilled by scheduleHighlightsRecovery() AFTER digest
    // generation, which can land after this hook's own retry budget gives
    // up. digestLoading:true->false is the signal that recovery has now
    // been scheduled server-side. CodeRabbit review, PR #294: the original
    // version of this test only made 1 fetch call before flipping
    // digestLoading, never proving the re-trigger works AFTER the full
    // 8-attempt retry schedule has genuinely exhausted to confirmed-empty.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ digestLoading }: { digestLoading: boolean }) => useHighlightsStatus('a1', 'complete', digestLoading),
      { initialProps: { digestLoading: true } }
    );

    // Run through the complete 8-attempt retry schedule (45s total).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(46000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(result.current).toEqual({ hasHighlights: false, count: 0 });

    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}] }) });
    rerender({ digestLoading: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toEqual({ hasHighlights: true, count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(9);
    vi.useRealTimers();
  });

  it('recovers to true if a later retry attempt finds highlights after earlier empty attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ highlights: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ highlights: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useHighlightsStatus('a1', 'complete'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    expect(result.current).toEqual({ hasHighlights: true, count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a malformed (non-array) response as unknown, never as confirmed-empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: 'not-an-array' }) })
    );
    const { result } = renderHook(() => useHighlightsStatus('a1', 'complete'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    expect(result.current).toEqual({ hasHighlights: null, count: 0 });
  });

  it('resets to null immediately when switching from one completed analysis to another, never flashing the previous analysis badge', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ id }: { id: string }) => useHighlightsStatus(id, 'complete'), {
      initialProps: { id: 'a1' },
    });

    // Switch to a second analysis before the first request ever resolves.
    rerender({ id: 'a2' });
    expect(result.current).toEqual({ hasHighlights: null, count: 0 });

    await waitFor(() => expect(result.current.hasHighlights).toBe(true));
    expect(result.current.count).toBe(2);

    // The stale first request resolving late must not clobber the new result.
    resolveFirst({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}, {}, {}, {}] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.count).toBe(2);
  });

  it('does NOT abort/restart the active fetch cycle when digestLoading flips false->true mid-retry (phase-c T2 abort-loop regression)', async () => {
    // phase-c T2 (2026-10-08): the old single effect keyed on
    // [analysisId, status, digestLoading] ran its cleanup (abort) before its
    // body on EVERY dep change, so a digestLoading flip during streaming
    // killed the in-flight cycle and restarted the loop at attempt 0 --
    // rapid-fire CANCELLED requests and a retry budget that never completed
    // (badge stuck null = silent hang). Same bug class Cubic flagged on PR
    // #298 in HighlightsScrubber. The fix splits the lifecycle: only
    // analysisId/status changes may abort a cycle; a digestLoading flip is
    // either a no-op (false->true) or a deliberate new-cycle START
    // (true->false), never an abort of the active cycle.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderHook(
      ({ digestLoading }: { digestLoading: boolean }) => useHighlightsStatus('a1', 'complete', digestLoading),
      { initialProps: { digestLoading: false } }
    );

    // Attempt 0 fires and resolves empty; the cycle is now sitting in its
    // backoff wait (attempt 1 scheduled at +3s).
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A digest refresh STARTING (false->true) must not abort/restart the
    // active cycle -- no new fetch, no reset of the backoff schedule.
    rerender({ digestLoading: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The original cycle's backoff is still intact: attempt 1 lands on the
    // ORIGINAL schedule (~3s after attempt 0), not restarted from scratch.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // And the cycle still completes normally to confirmed-empty.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('encodes the analysisId in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useHighlightsStatus('id with spaces & stuff', 'complete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('id with spaces & stuff'));
  });

  it('restores A badge (no refetch) when returning to A while B is in flight (A -> B -> A, PR #442 5a)', async () => {
    // The stale-B request never resolves -- B stays pending the whole time.
    let pendingB: (value: unknown) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}] }) }))
      .mockImplementationOnce(() => new Promise((resolve) => { pendingB = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ id }: { id: string }) => useHighlightsStatus(id, 'complete'), {
      initialProps: { id: 'a1' },
    });

    // A settles with highlights.
    await waitFor(() => expect(result.current).toEqual({ hasHighlights: true, count: 2 }));

    // Switch to B -- still in flight, badge must reset to null.
    rerender({ id: 'b1' });
    expect(result.current).toEqual({ hasHighlights: null, count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Back to A: badge restored from cache, and B's in-flight request must
    // be aborted -- no third fetch, and A's settled value wins over B's
    // late resolution.
    rerender({ id: 'a1' });
    await waitFor(() => expect(result.current).toEqual({ hasHighlights: true, count: 2 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Negative-guard: B's late resolution can never clobber A's badge.
    pendingB({ ok: true, json: () => Promise.resolve({ highlights: [{}, {}, {}, {}] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ hasHighlights: true, count: 2 });
  });

  it('does NOT fetch when digestLoading goes true -> false while status is not complete (PR #442 5b)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender, result } = renderHook(
      ({ digestLoading }: { digestLoading: boolean }) => useHighlightsStatus('a1', 'analyzing', digestLoading),
      { initialProps: { digestLoading: true } }
    );

    rerender({ digestLoading: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ hasHighlights: null, count: 0 });
  });
});
