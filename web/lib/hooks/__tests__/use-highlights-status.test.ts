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

    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.hasHighlights).toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.hasHighlights).toBe(null);

    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ hasHighlights: false, count: 0 });
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
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });

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

  it('encodes the analysisId in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useHighlightsStatus('id with spaces & stuff', 'complete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('id with spaces & stuff'));
  });
});
