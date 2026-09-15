/**
 * fetch with a hard timeout — a request that never settles (a stalled or
 * hanging connection, not a clean rejection) must not be awaited forever.
 *
 * Shape convention (PR #313 post-merge review P0b, 2026-09-15):
 * AbortController + setTimeout + clearTimeout(finally), following the
 * in-repo precedent in web/lib/admin-logs/fetchers.ts
 * (QSTASH_LOGS_TIMEOUT_MS). Deliberately NOT AbortSignal.timeout(): that is
 * backed by native timers and cannot be driven by vitest fake timers (see
 * useChatStore-resilience.test.ts's own comment), which would leave the
 * timeout path untestable in this repo's hook tests.
 *
 * 10s: bounded far above a healthy same-origin API JSON response (the
 * third-party QStash precedent is 8s) and far below anything a user waits
 * on intentionally. A single named constant, not a Settings Registry entry
 * — client-side UI fetch, no registry precedent exists for these hooks
 * (the remediation/billing registry keys are all server-side).
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Overrides init.signal by design — this helper exists to guarantee a
    // deadline; no current call site passes its own signal.
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
