import { useCallback, useEffect, useRef, useState } from 'react';
import { getHighlightsRetryDelayMs, HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS } from '@/lib/utils/highlights-settings';
import { dedupedFetch } from '@/lib/utils/dedupe-fetch';

export interface HighlightsStatusResult {
  /** true = highlights present, false = confirmed zero after bounded retry, null = not yet known (loading/error/no analysis/malformed response) */
  hasHighlights: boolean | null;
  count: number;
}

const IDLE: HighlightsStatusResult = { hasHighlights: null, count: 0 };

/**
 * Lightweight highlights-count fetch for the aux-status badge row (mirrors
 * ChapterChip's 3-state pattern in primitives.tsx). Not the HighlightsScrubber's
 * fetch -- that one drives the actual scrubber UI and has its own richer
 * state; this is a cheap count-only check for the status chip.
 *
 * `digestLoading` is a deliberate re-trigger, not just a value read: see
 * HighlightsScrubber.tsx and highlights-settings.ts's retry-constants doc
 * for the full mechanism -- highlights are backfilled by
 * scheduleHighlightsRecovery() AFTER digest generation, so a
 * digestLoading:true->false transition is the real, video-length-scaled
 * signal that recovery has now been scheduled server-side, not a fixed
 * timeout guessed from stream-completion (real production race, confirmed
 * 2026-09-08 against the live DB).
 *
 * T2 phase-c fix (2026-10-08): the previous single effect keyed on
 * [analysisId, status, digestLoading] ran its cleanup (controller.abort)
 * before its body on EVERY dep change -- an in-body early-return guard
 * cannot prevent React from tearing down first. Any digestLoading flip
 * mid-retry-cycle therefore killed the in-flight request and restarted the
 * loop at attempt 0 (rapid-fire CANCELLED requests in the Network tab, and
 * a cycle that could never complete -> badge stuck null). Same bug class
 * Cubic flagged on PR #298 in HighlightsScrubber. Fixed with the same
 * two-effect split: Effect A owns the abort/cleanup lifecycle keyed on
 * [analysisId, status] only; Effect B only ever STARTS a new cycle on a
 * genuine digestLoading true->false transition and has NO cleanup, so a
 * flip can never abort an active cycle.
 */
export function useHighlightsStatus(analysisId: string | null, status: string, digestLoading?: boolean): HighlightsStatusResult {
  const [result, setResult] = useState<HighlightsStatusResult>(IDLE);
  // Tracks which analysisId `result` actually belongs to. CodeRabbit finding
  // (PR #294): checking `result.hasHighlights === true` alone, with no
  // analysisId check, meant switching to a NEW analysisId while the OLD
  // analysisId's result still had hasHighlights===true skipped the reset
  // AND the fetch entirely -- exposing the previous analysis's "done" badge
  // under the new one until something else happened to re-trigger the effect.
  const loadedForAnalysisIdRef = useRef<string | null>(null);
  // Set ONLY when hasHighlights===true commits (distinct from
  // loadedForAnalysisIdRef, which also covers confirmed-empty) -- the
  // "already found" guard for re-runs.
  const foundForAnalysisIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runFetchCycle = useCallback((id: string) => {
    // Cancel whatever cycle (if any) is currently running before starting a
    // new one -- keeps runFetchCycle safe to call from either effect below.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const requestAnalysisId = id;
    let attemptsMade = 0;

    (async () => {
      try {
        for (let attempt = 0; attempt < HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS; attempt++) {
          attemptsMade = attempt + 1;
          // Shared in-flight dedupe (network-storms RCA 2026-09-26): the
          // scrubber loop and this status-chip loop fire the identical GET
          // on the same backoff schedule -- collapse them into one real
          // request per attempt. The local controller still owns
          // staleness: every await below re-checks `controller.signal.aborted`
          // before committing state.
          const res = await dedupedFetch(`/api/analyses/highlights?analysisId=${encodeURIComponent(requestAnalysisId)}`, { signal: controller.signal });
          if (!res.ok) throw new Error(`highlights status fetch failed: ${res.status}`);
          const json = await res.json();
          if (!json || !Array.isArray(json.highlights)) {
            // Malformed response is "unknown," not "confirmed empty" --
            // never report false on a shape we can't actually trust.
            if (controller.signal.aborted) return;
            setResult(IDLE);
            return;
          }
          const count = json.highlights.length;
          if (count > 0) {
            if (controller.signal.aborted) return;
            loadedForAnalysisIdRef.current = requestAnalysisId;
            foundForAnalysisIdRef.current = requestAnalysisId;
            setResult({ hasHighlights: true, count });
            return;
          }
          if (attempt < HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS - 1) {
            // Abort-aware wait: settle the moment the effect cleans up
            // (analysisId changed again / unmount) instead of always
            // sitting through the full backoff delay first (CodeRabbit
            // review, PR #294).
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, getHighlightsRetryDelayMs(attempt));
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
              }, { once: true });
            });
            if (controller.signal.aborted) return;
          }
        }
        // Still empty after every retry: a confirmed zero-result extraction.
        if (controller.signal.aborted) return;
        loadedForAnalysisIdRef.current = requestAnalysisId;
        setResult({ hasHighlights: false, count: 0 });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn(`[useHighlightsStatus] failed to load highlights status for ${requestAnalysisId}:`, err);
        setResult(IDLE);
      } finally {
        // Real diagnostic value, not a no-op: this is exactly the class of
        // production race (highlights backfilled asynchronously, client
        // polling) that motivated this hook's retry design in the first
        // place -- knowing how many attempts a cycle actually took before
        // settling (aborted, error, or resolved) is the fastest way to
        // confirm the retry window is sized correctly without a DB query.
        console.debug(`[useHighlightsStatus] fetch cycle settled for ${requestAnalysisId} after ${attemptsMade} attempt(s), aborted=${controller.signal.aborted}`);
      }
    })();
  }, []);

  // Effect A: owns the fetch cycle's start/abort lifecycle. Keyed ONLY on
  // [analysisId, status] -- a digestLoading change must never trigger this
  // effect's cleanup, or it would abort an active cycle (see Effect B) with
  // nothing left to replace it.
  useEffect(() => {
    if (status !== 'complete' || !analysisId) {
      abortControllerRef.current?.abort();
      loadedForAnalysisIdRef.current = null;
      foundForAnalysisIdRef.current = null;
      setResult(IDLE);
      return;
    }

    // Already have real highlights for THIS analysisId (e.g. same id
    // re-completing after a status blip): a later digestLoading flip must
    // not blank/reset the badge. A confirmed-EMPTY result deliberately does
    // NOT short-circuit -- see Effect B for the retry path.
    if (foundForAnalysisIdRef.current === analysisId) return;

    setResult(IDLE);
    runFetchCycle(analysisId);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [analysisId, status, runFetchCycle]);

  // Effect B: the digestLoading:true->false recovery trigger --
  // scheduleHighlightsRecovery() is scheduled server-side AFTER digest
  // generation completes, which can land well after Effect A's own retry
  // budget has already given up. This effect has NO cleanup function, so a
  // digestLoading change (in either direction) can never abort Effect A's
  // in-flight cycle -- it can only ever START a new one, and only on a
  // genuine true->false transition.
  const prevDigestLoadingRef = useRef<boolean | undefined>(digestLoading);
  // If analysisId ALSO changed in the same render as the true->false
  // transition, Effect A already started a fresh cycle for the new id --
  // this effect firing too would abort that brand-new cycle and start a
  // needless duplicate for the exact same id.
  const prevAnalysisIdForDigestEffectRef = useRef<string | null>(analysisId);
  useEffect(() => {
    const wasTrueNowFalse = prevDigestLoadingRef.current === true && digestLoading === false;
    const analysisIdChangedThisRender = prevAnalysisIdForDigestEffectRef.current !== analysisId;
    prevDigestLoadingRef.current = digestLoading;
    prevAnalysisIdForDigestEffectRef.current = analysisId;
    if (!wasTrueNowFalse || analysisIdChangedThisRender) return;
    if (!analysisId) return;
    // Already found real highlights for THIS analysisId -- don't refetch.
    if (foundForAnalysisIdRef.current === analysisId) return;
    runFetchCycle(analysisId);
  }, [digestLoading, analysisId, runFetchCycle]);

  // CodeRabbit finding, PR #294: guard the RETURNED value too, not just the
  // effect's own re-trigger -- if analysisId changed but this render still
  // runs before the effect above has fired (React renders synchronously,
  // effects run after paint), `result` could briefly still hold the
  // PREVIOUS analysisId's settled value. Must also check `status` (second
  // CodeRabbit round): if the SAME analysisId re-analyzes (status flips
  // complete->processing), loadedForAnalysisIdRef still matches, so the
  // ownership check alone wouldn't catch the now-stale settled result.
  if (status !== 'complete' || loadedForAnalysisIdRef.current !== analysisId) return IDLE;
  return result;
}
