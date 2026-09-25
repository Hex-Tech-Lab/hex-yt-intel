import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryOverviewItem } from '@/lib/ports';

interface HistoryOverviewState {
  items: HistoryOverviewItem[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Live-status polling cadence for rows whose background state is still moving
 * (reaper ADR 007 sweeps run every 15 min via QStash; remediation requeue
 * transitions land between sweeps). 30 s is fast enough that a transition is
 * visible within the minute it lands, slow enough that a fully-processing
 * History tab costs ~2 extra requests/min, and it stays well inside the
 * 15-minute SQL staleness boundary the overview function already applies
 * (so no transition can be missed between polls).
 */
export const HISTORY_LIVE_POLL_MS = 30_000;

/**
 * True when at least one item's background state can still change: actively
 * processing, or stalled (reaper/remediation recovery still pending). Pure,
 * exported for unit testing.
 */
export function hasLiveStatusItems(items: Pick<HistoryOverviewItem, 'status'>[]): boolean {
  return items.some(item => item.status === 'processing' || item.status === 'stalled');
}

/**
 * Fetches the video-centric history overview — one aggregated row per underlying
 * video (archived re-runs collapsed) — from GET /api/analyses/overview.
 *
 * RCA (2026-07-24, live production): fetched once on mount only. A re-analysis
 * completed while the History tab stayed mounted showed the DIGEST/DESCRIPTION/
 * CHANNEL META/COMMENTS chips and status stuck at their pre-analysis values --
 * the server-side data was correct, but nothing ever told this hook to refetch.
 * `refetch` lets callers (AnalysisHistory, watching analysis-completion status)
 * force a fresh read without needing to unmount/remount the whole component.
 *
 * RCA (2026-09-25, live production, analysis 6047514f): while that row died
 * mid-stream and the reaper later settled it, the History card kept showing
 * 'Processing' until manual reload — the 2026-07-24 fix only refetches on
 * analysis-completion events, never on BACKGROUND transitions (reaper settle,
 * remediation requeue). Polling: while any item is processing/stalled, the
 * overview is refetched every HISTORY_LIVE_POLL_MS; the moment every row is
 * terminal, polling stops. Background polls are silent (no skeleton flash).
 */
export function useHistoryOverview() {
  const [state, setState] = useState<HistoryOverviewState>({
    items: [],
    isLoading: true,
    error: null,
  });
  const cancelledRef = useRef(false);
  // Monotonic request sequence: only the most recently STARTED fetch may
  // settle state. Mount, silent poll, and manual refetch can all overlap
  // (a slow silent poll resolving after a fresh manual refetch must not
  // overwrite the newer response with older data).
  const seqRef = useRef(0);

  const fetchOverview = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++seqRef.current;
    try {
      if (!opts?.silent) {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
      }
      const res = await fetch('/api/analyses/overview', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (cancelledRef.current || seqRef.current !== seq) return;
      setState({ items: data.items || [], isLoading: false, error: null });
    } catch (err) {
      if (cancelledRef.current || seqRef.current !== seq) return;
      // A failed background poll is silent on the error surface too: keep the
      // last good items rendered and retry on the next tick, rather than
      // tearing the list down over a transient fetch failure.
      if (opts?.silent) return;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load history',
      }));
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchOverview();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchOverview]);

  const hasLive = hasLiveStatusItems(state.items);

  useEffect(() => {
    if (!hasLive) return;
    const pollId = setInterval(() => {
      void fetchOverview({ silent: true });
    }, HISTORY_LIVE_POLL_MS);
    return () => clearInterval(pollId);
  }, [hasLive, fetchOverview]);

  return { ...state, refetch: fetchOverview };
}
