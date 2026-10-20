/**
 * Concurrency-bounded execution helper.
 *
 * Runs `fn` over `items` with at most `limit` asynchronous invocations
 * in flight concurrently.
 *
 * Invariants:
 * 1. Preserves item result order corresponding to input `items`.
 * 2. Does not exceed `limit` concurrent promises in flight.
 * 3. Does not stop or cancel remaining items if one worker task rejects (settles via Promise.allSettled style or user error handling).
 * 4. Empty array returns empty array immediately.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      // Every outcome is recorded as a settled result (Promise.allSettled
      // semantics); a rejection is data for the caller, not swallowed.
      results[idx] = await fn(items[idx] as T, idx).then(
        (value): PromiseSettledResult<R> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseSettledResult<R> => ({ status: 'rejected', reason }),
      );
    }
  }

  const workers = Array.from({ length: safeLimit }, () => worker());
  await Promise.all(workers);
  return results;
}
