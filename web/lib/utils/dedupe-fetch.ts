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
}

const inFlight = new Map<string, InFlightEntry>();

export function dedupedFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  let entry = inFlight.get(url);
  if (!entry) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        if (inFlight.get(url) === entry) inFlight.delete(url);
      }
    })();
    
    entry = { promise, controller, consumers: 0 };
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
        if (!detached) resolve(res.clone());
      })
      .catch(err => {
        if (!detached) reject(err);
      })
      .finally(() => {
        detach();
      });
  });
}
