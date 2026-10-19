/**
 * Lightweight in-memory query cache for client-side API requests.
 *
 * Enforces:
 * - Configurable staleTime (default 5 minutes: 5 * 60 * 1000).
 * - Concurrent in-flight request deduplication per query key.
 * - Explicit invalidation and cache clearing.
 * - refetchOnWindowFocus disabled by default to eliminate egress bleed on tab switches.
 */

export interface CacheOptions {
  staleTime?: number; // default: 5 * 60 * 1000 (5 minutes)
  refetchOnWindowFocus?: boolean; // default: false
}

export const DEFAULT_STALE_TIME = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_REFETCH_ON_FOCUS = false;

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  staleTime: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Retrieve a query result from cache if fresh; otherwise invoke fetcher,
 * deduplicating concurrent in-flight requests for the same key.
 */
export async function getCachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: CacheOptions
): Promise<T> {
  const staleTime = options?.staleTime ?? DEFAULT_STALE_TIME;

  // 1. Check if fresh cached data exists
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < staleTime) {
    return entry.data as T;
  }

  // 2. Check if a request for this key is already in flight (deduplicate)
  const existingInFlight = inFlight.get(key);
  if (existingInFlight) {
    return existingInFlight as Promise<T>;
  }

  // 3. Start a new fetch and record in-flight promise
  const promise = (async () => {
    try {
      const data = await fetcher();
      cache.set(key, {
        data,
        timestamp: Date.now(),
        staleTime,
      });
      return data;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Invalidate a specific cached query by key so subsequent calls fetch fresh data.
 */
export function invalidateCachedQuery(key: string): void {
  cache.delete(key);
  inFlight.delete(key);
}

/**
 * Manually set or prime the cache for a key.
 */
export function setCachedQuery<T>(
  key: string,
  data: T,
  staleTime: number = DEFAULT_STALE_TIME
): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    staleTime,
  });
}

/**
 * Synchronously peek at cached data for a key without triggering a fetch.
 * Returns undefined if missing or stale.
 */
export function peekCachedQuery<T>(
  key: string,
  options?: CacheOptions
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  const staleTime = options?.staleTime ?? entry.staleTime ?? DEFAULT_STALE_TIME;
  if (Date.now() - entry.timestamp >= staleTime) {
    return undefined;
  }
  return entry.data as T;
}

/**
 * Reset all cached items and in-flight requests (primarily for tests and user sign-out).
 */
export function clearClientCache(): void {
  cache.clear();
  inFlight.clear();
}
