// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAnalysisHistory } from '@/hooks/useAnalysisHistory';
import { clearClientCache, peekCachedQuery } from '@/lib/utils/client-cache';

describe('useAnalysisHistory (user-scoped caching & auth guard)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearClientCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearClientCache();
    vi.restoreAllMocks();
  });

  it('unauthenticated bypass: does not fetch or touch cache when userId is absent', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useAnalysisHistory(''));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('user-scoped caching: caches items under analysis-history:${userId}', async () => {
    const sampleItems = [
      { id: 'a-1', videoId: 'v-1', title: 'Test 1', createdAt: '2026-10-01', status: 'completed' as const },
    ];

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ analyses: sampleItems }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useAnalysisHistory('user-alpha'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toEqual(sampleItems);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(peekCachedQuery('analysis-history:user-alpha')).toEqual(sampleItems);
    expect(peekCachedQuery('analysis-history:user-beta')).toBeUndefined();
  });
});
