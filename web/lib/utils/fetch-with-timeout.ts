/**
 * fetch with a hard timeout that stays armed through body consumption.
 *
 * A request that never settles — a stalled connection (headers never arrive)
 * OR a response whose body never completes (headers arrive but `.json()`
 * hangs) — must not be awaited forever. The previous shape returned the
 * bare `Response` and cleared the timer in `finally` as soon as `fetch()`
 * resolved HEADERS, so a stalled `response.json()` after the helper
 * returned was uncovered: the retry loop stayed blocked forever on a
 * hang the timeout was written to prevent, one layer deeper.
 *
 * Callback shape (PR #315 review round 2, 2026-09-15): the caller passes
 * its body-consumption logic (`.json()`, `.text()`, or just reading
 * `res.ok` and returning without consuming) as `consumeResponse`, which
 * runs INSIDE the timeout window. `clearTimeout` only fires after
 * `consumeResponse` settles — so a stalled body aborts on the same
 * schedule a stalled connection does.
 *
 * Signal composition (PR #315 P1-7): if the caller passes `init.signal`
 * (e.g. for unmount-cancellation), it is composed with the timeout
 * controller's signal — either one aborting aborts the fetch. No current
 * caller passes a signal, but the contract is now intentional, not
 * accidental.
 *
 * Deliberately NOT AbortSignal.timeout(): that is backed by native timers
 * and cannot be driven by vitest fake timers (see useChatStore-resilience
 * test's own comment), which would leave the timeout path untestable.
 * AbortController + setTimeout + clearTimeout(finally) follows the
 * in-repo precedent in web/lib/admin-logs/fetchers.ts.
 *
 * 10s: bounded far above a healthy same-origin API JSON response (the
 * third-party QStash precedent is 8s) and far below anything a user
 * waits on intentionally.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit | undefined,
  consumeResponse: (res: Response) => Promise<T>,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose caller-signal + timeout-signal: if the caller's signal is
  // already aborted, abort immediately; otherwise listen for its abort
  // and forward it to our controller. Either source aborting kills the
  // fetch + any in-progress body stream read inside consumeResponse.
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // consumeResponse runs BEFORE clearTimeout — a stalled .json() is
    // still inside the timeout window and will be aborted on schedule.
    return await consumeResponse(res);
  } finally {
    clearTimeout(timer);
  }
}
