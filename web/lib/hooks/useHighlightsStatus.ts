import { useEffect, useState } from 'react';

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
 * Bounded-retry mirrors HighlightsScrubber.tsx's own pattern exactly (same
 * 3-attempt/backoff shape): the highlights API has no separate "extraction
 * status" field distinct from the highlights array itself, so an empty
 * response immediately after an analysis completes is genuinely ambiguous
 * between "confirmed zero" and "not persisted yet" (a real, observed
 * finalization race -- external review finding). Only commits to
 * `hasHighlights: false` after the array is still empty on the final
 * attempt.
 */
export function useHighlightsStatus(analysisId: string | null, status: string): HighlightsStatusResult {
  const [result, setResult] = useState<HighlightsStatusResult>(IDLE);

  useEffect(() => {
    if (status !== 'complete' || !analysisId) {
      setResult(IDLE);
      return;
    }

    // Reset immediately for the NEW analysisId, not the previous one's
    // result -- otherwise switching directly between two completed
    // analyses could flash the old analysis's badge state while the new
    // fetch is in flight (external review finding).
    setResult(IDLE);

    const controller = new AbortController();
    const requestAnalysisId = analysisId;

    (async () => {
      try {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2500 * Math.pow(2, attempt)));
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
  }, [analysisId, status]);

  return result;
}
