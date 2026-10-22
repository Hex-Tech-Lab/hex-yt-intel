// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUsageSummary } from '@/hooks/useUsageSummary';
import { clearClientCache, peekCachedQuery } from '@/lib/utils/client-cache';

describe('useUsageSummary (user-scoped caching & auth guard)', () => {
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

    const { result } = renderHook(() => useUsageSummary(true, ''));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.summary).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('disabled bypass: does not fetch when enabled is false', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useUsageSummary(false, 'user-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.summary).toBeNull();
  });

  it('user-scoped caching: caches summary under usage-summary:${userId}', async () => {
    const sampleSummary = {
      periodStart: '2026-10-01',
      tier: 'pro',
      analyses: { used: 3, quota: 100 },
      chatTurns: { synthesisConsole: 10, atlas: 0, total: 10 },
      estimatedCostUsd: 1.5,
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sampleSummary),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useUsageSummary(true, 'user-alpha'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.summary).toEqual(sampleSummary);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(peekCachedQuery('usage-summary:user-alpha')).toEqual(sampleSummary);
    expect(peekCachedQuery('usage-summary:user-beta')).toBeUndefined();
  });
});
