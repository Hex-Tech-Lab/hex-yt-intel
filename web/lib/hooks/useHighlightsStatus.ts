import { useEffect, useState } from 'react';
import { getHighlightsRetryDelayMs, HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS } from '@/lib/utils/highlights-settings';

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
 * `digestLoading` is a deliberate re-trigger dependency, not just a value
 * read: see HighlightsScrubber.tsx and highlights-settings.ts's retry-
 * constants doc for the full mechanism -- highlights are backfilled by
 * scheduleHighlightsRecovery() AFTER digest generation, so a
 * digestLoading:true->false transition is the real, video-length-scaled
 * signal that recovery has now been scheduled server-side, not a fixed
 * timeout guessed from stream-completion (real production race, confirmed
 * 2026-09-08 against the live DB).
 */
export function useHighlightsStatus(analysisId: string | null, status: string, digestLoading?: boolean): HighlightsStatusResult {
  const [result, setResult] = useState<HighlightsStatusResult>(IDLE);

  useEffect(() => {
    if (status !== 'complete' || !analysisId) {
      setResult(IDLE);
      return;
    }

    // Already have real highlights -- a later digestLoading flip (e.g. a
    // manual digest refresh) must not blank/reset the badge. Deliberately
    // NOT in the dependency array: a guard read of the current value, not
    // a re-trigger condition (see HighlightsScrubber.tsx for the same
    // pattern).
    if (result.hasHighlights === true) return;

    // Reset immediately for the NEW analysisId, not the previous one's
    // result -- otherwise switching directly between two completed
    // analyses could flash the old analysis's badge state while the new
    // fetch is in flight (external review finding).
    setResult(IDLE);

    const controller = new AbortController();
    const requestAnalysisId = analysisId;

    (async () => {
      try {
        for (let attempt = 0; attempt < HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS; attempt++) {
          const res = await fetch(`/api/analyses/highlights?analysisId=${encodeURIComponent(requestAnalysisId)}`, {
            signal: controller.signal,
          });
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
            setResult({ hasHighlights: true, count });
            return;
          }
          if (attempt < HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, getHighlightsRetryDelayMs(attempt)));
            if (controller.signal.aborted) return;
          }
        }
        // Still empty after every retry: a confirmed zero-result extraction.
        if (controller.signal.aborted) return;
        setResult({ hasHighlights: false, count: 0 });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn(`[useHighlightsStatus] failed to load highlights status for ${requestAnalysisId}:`, err);
        setResult(IDLE);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `result` is a
    // deliberate guard read above, not a dependency (see its comment).
  }, [analysisId, status, digestLoading]);

  return result;
}
