/**
 * Shared in-flight dedupe for identical same-origin GET fetches.
 *
 * Network-storm RCA (2026-09-26 console audit): two independent consumers
 * (useHighlightsStatus's status-chip loop and HighlightsScrubber's
 * scrubber loop) each run their own bounded-retry fetch cycle against
 * `/api/analyses/highlights` for the SAME analysisId, on the same backoff
 * schedule -- 2 consumers x 5 attempts = 10 identical network requests
 * where 5 suffice. This helper collapses concurrent identical GETs into
 * one real network request: the first caller's fetch is shared with every
 * caller that arrives while it is still in flight.
 *
 * Abort semantics: callers keep their OWN AbortController for lifecycle
 * (staleness) checks as before -- a local abort must not kill a shared
 * request another consumer still needs. The underlying request IS aborted
 * when the LAST consumer detaches while still in flight (unmount of the
 * sole interested party), so real cancellation is preserved. Callers that
 * already check their own `controller.signal.aborted` after awaiting
 * (both highlights consumers do) remain correct when they receive a
 * response that their local controller has since outlived.
 *
 * Deliberately GET-only in practice (idempotent reads); keyed by URL --
 * callers must not pass per-request headers that vary between consumers.
 */

interface InFlightEntry {
  promise: Promise<Response>;
  controller: AbortController;
  consumers: number;
  /** Settled flag — RCA 2026-09-27: a caller could inherit an entry whose
   * shared fetch had ALREADY rejected (e.g. the last consumer detached and
   * aborted it between map insertion and the next caller's map.get — the
   * deleting finally is async, the rejection is synchronous). The new
   * caller then rejected with the dead entry's AbortError and, in
   * HighlightsScrubber, rendered the loading state forever. New callers
   * now bypass settled entries and start a fresh request. */
  settled: boolean;
}

const inFlight = new Map<string, InFlightEntry>();

export function dedupedFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  let entry = inFlight.get(url);
  // Never inherit a settled (dead) entry — start fresh instead.
  if (entry?.settled) {
    inFlight.delete(url);
    entry = undefined;
  }
  if (!entry) {
    const controller = new AbortController();
    const created: InFlightEntry = { promise: undefined as unknown as Promise<Response>, controller, consumers: 0, settled: false };
    created.promise = (async () => {
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        created.settled = true;
        if (inFlight.get(url) === created) inFlight.delete(url);
      }
    })();
    entry = created;
    inFlight.set(url, entry);
  }

  entry.consumers += 1;
  const currentEntry = entry;

  return new Promise<Response>((resolve, reject) => {
    let detached = false;

    const detach = () => {
      if (detached) return;
      detached = true;
      currentEntry.consumers -= 1;
      if (currentEntry.consumers === 0) currentEntry.controller.abort();
    };

    if (init?.signal) {
      if (init.signal.aborted) {
        detach();
        return reject(new DOMException("Aborted", "AbortError"));
      }
      init.signal.addEventListener("abort", () => {
        detach();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    currentEntry.promise
      .then(res => {
        // Real Response objects must be cloned: the original body is shared with
        // other in-flight consumers. Plain-object mocks (test doubles, some SSR
        // shims) have no clone() and are single-consumer by construction, so
        // pass them through unchanged (PR #354 CI incident, 2026-09-26).
        if (!detached) resolve(typeof res.clone === 'function' ? res.clone() : res);
      })
      .catch(err => {
        if (!detached) reject(err);
      })
      .finally(() => {
        detach();
      });
  });
}
