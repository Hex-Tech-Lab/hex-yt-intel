import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedQuery,
  invalidateCachedQuery,
  setCachedQuery,
  peekCachedQuery,
  clearClientCache,
  DEFAULT_STALE_TIME,
} from '../client-cache';

describe('client-cache utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearClientCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearClientCache();
  });

  it('fetches and caches data on first request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1, name: 'Analysis 1' });

    const result = await getCachedQuery('key-1', fetcher);
    expect(result).toEqual({ id: 1, name: 'Analysis 1' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Immediate second call should return cached result without calling fetcher
    const cachedResult = await getCachedQuery('key-1', fetcher);
    expect(cachedResult).toEqual({ id: 1, name: 'Analysis 1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent in-flight requests for the same key', async () => {
    let resolvePromise!: (val: string) => void;
    const slowFetcher = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolvePromise = res;
        })
    );

    // Trigger two concurrent requests
    const promise1 = getCachedQuery('key-dedupe', slowFetcher);
    const promise2 = getCachedQuery('key-dedupe', slowFetcher);

    expect(slowFetcher).toHaveBeenCalledTimes(1);

    resolvePromise('resolved-data');

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe('resolved-data');
    expect(res2).toBe('resolved-data');
    expect(slowFetcher).toHaveBeenCalledTimes(1);
  });

  it('respects TTL expiration and re-fetches when stale', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first-response')
      .mockResolvedValueOnce('second-response');

    const result1 = await getCachedQuery('key-ttl', fetcher, { staleTime: 1000 });
    expect(result1).toBe('first-response');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance time within staleTime window (500ms < 1000ms)
    vi.advanceTimersByTime(500);

    const resultCached = await getCachedQuery('key-ttl', fetcher, { staleTime: 1000 });
    expect(resultCached).toBe('first-response');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance time past staleTime window (600ms more -> 1100ms > 1000ms)
    vi.advanceTimersByTime(600);

    const resultFresh = await getCachedQuery('key-ttl', fetcher, { staleTime: 1000 });
    expect(resultFresh).toBe('second-response');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses DEFAULT_STALE_TIME (5 minutes) when staleTime option is omitted', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('after-5m');

    await getCachedQuery('default-ttl', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance time 4.5 minutes (270,000ms < 300,000ms)
    vi.advanceTimersByTime(4.5 * 60 * 1000);
    const cached = await getCachedQuery('default-ttl', fetcher);
    expect(cached).toBe('initial');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance past 5 minutes (30,001ms more -> 300,001ms > 300,000ms)
    vi.advanceTimersByTime(30_001);
    const fresh = await getCachedQuery('default-ttl', fetcher);
    expect(fresh).toBe('after-5m');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('allows manual invalidation via invalidateCachedQuery', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('data-v1')
      .mockResolvedValueOnce('data-v2');

    const res1 = await getCachedQuery('invalidate-key', fetcher);
    expect(res1).toBe('data-v1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Manually invalidate
    invalidateCachedQuery('invalidate-key');

    // Should immediately refetch on next call
    const res2 = await getCachedQuery('invalidate-key', fetcher);
    expect(res2).toBe('data-v2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('supports peekCachedQuery to inspect cache synchronously', async () => {
    expect(peekCachedQuery('peek-key')).toBeUndefined();

    setCachedQuery('peek-key', { value: 42 }, 2000);
    expect(peekCachedQuery<{ value: number }>('peek-key')).toEqual({ value: 42 });

    // Advance time past TTL
    vi.advanceTimersByTime(2500);
    expect(peekCachedQuery('peek-key')).toBeUndefined();
  });

  it('supports setCachedQuery to prime cache manually', async () => {
    const fetcher = vi.fn().mockResolvedValue('network-data');

    setCachedQuery('primed-key', 'local-seed', 5000);

    const res = await getCachedQuery('primed-key', fetcher, { staleTime: 5000 });
    expect(res).toBe('local-seed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cleans up in-flight promise if fetcher throws so retry is possible', async () => {
    const failingFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('recovered-data');

    await expect(getCachedQuery('retry-key', failingFetcher)).rejects.toThrow('Network error');

    // Subsequent call should be allowed to retry instead of being stuck in failed in-flight state
    const recovered = await getCachedQuery('retry-key', failingFetcher);
    expect(recovered).toBe('recovered-data');
    expect(failingFetcher).toHaveBeenCalledTimes(2);
  });

  it('resolving an invalidated in-flight request does not populate peekCachedQuery (generation fence)', async () => {
    let resolveFirst!: (val: string) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolveFirst = res;
        })
    );

    // 1. Dispatch request (enters in-flight)
    const pendingPromise = getCachedQuery('fenced-key', fetcher);

    // 2. Invalidate while request is in flight
    invalidateCachedQuery('fenced-key');

    // 3. Resolve the stale in-flight request
    resolveFirst('stale-data');
    await pendingPromise;

    // 4. Assert that peekCachedQuery was NOT populated with the stale data
    expect(peekCachedQuery('fenced-key')).toBeUndefined();
  });

  it('resolving an old in-flight request does not displace a newer replacement from inFlight', async () => {
    let resolveFirst!: (val: string) => void;
    let resolveSecond!: (val: string) => void;

    const fetcher1 = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolveFirst = res;
        })
    );
    const fetcher2 = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolveSecond = res;
        })
    );

    // 1. First request is in flight
    const promise1 = getCachedQuery('displace-key', fetcher1);

    // 2. Invalidate, clearing in-flight and advancing generation
    invalidateCachedQuery('displace-key');

    // 3. Start a second request
    const promise2 = getCachedQuery('displace-key', fetcher2);

    // 4. Resolve the first (old) request
    resolveFirst('old-data');
    await promise1;

    // 5. Subsequent getCachedQuery while promise2 is still in-flight should reuse promise2 (deduplication)
    const fetcher3 = vi.fn().mockResolvedValue('third-data');
    const promise3 = getCachedQuery('displace-key', fetcher3);

    // fetcher3 must NOT be called because promise2 is still active in inFlight
    expect(fetcher3).not.toHaveBeenCalled();

    // 6. Now resolve promise2
    resolveSecond('new-data');
    const [res2, res3] = await Promise.all([promise2, promise3]);
    expect(res2).toBe('new-data');
    expect(res3).toBe('new-data');
    expect(peekCachedQuery('displace-key')).toBe('new-data');
  });
});

