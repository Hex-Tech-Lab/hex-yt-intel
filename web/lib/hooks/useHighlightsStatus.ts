import { useEffect, useState } from 'react';

export interface HighlightsStatusResult {
  /** true = highlights present, false = fetch succeeded but zero highlights, null = not yet known (loading/error/no analysis) */
  hasHighlights: boolean | null;
  count: number;
}

/**
 * Lightweight highlights-count fetch for the aux-status badge row (mirrors
 * ChapterChip's 3-state pattern in primitives.tsx). Not the HighlightsScrubber's
 * fetch -- that one drives the actual scrubber UI and has its own richer
 * state; this is a cheap count-only check for the status chip.
 */
export function useHighlightsStatus(analysisId: string | null, status: string): HighlightsStatusResult {
  const [result, setResult] = useState<HighlightsStatusResult>({ hasHighlights: null, count: 0 });

  useEffect(() => {
    if (status !== 'complete' || !analysisId) {
      setResult({ hasHighlights: null, count: 0 });
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/analyses/highlights?analysisId=${analysisId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`highlights status fetch failed: ${res.status}`);
        const json = await res.json();
        const count = Array.isArray(json?.highlights) ? json.highlights.length : 0;
        setResult({ hasHighlights: count > 0, count });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setResult({ hasHighlights: null, count: 0 });
      }
    })();

    return () => controller.abort();
  }, [analysisId, status]);

  return result;
}
