import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryOverviewItem } from '@/lib/ports';
import { getCachedQuery, peekCachedQuery, setCachedQuery } from '@/lib/utils/client-cache';

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
 * Uses client-cache with 5-minute TTL for initial mount and tab-switch caching,
 * while allowing background polling when live status items exist.
 */
export function useHistoryOverview() {
  const cached = peekCachedQuery<HistoryOverviewItem[]>('history-overview');
  const [state, setState] = useState<HistoryOverviewState>({
    items: cached ?? [],
    isLoading: !cached,
    error: null,
  });
  const cancelledRef = useRef(false);
  // Monotonic request sequence: only the most recently STARTED fetch may
  // settle state. Mount, silent poll, and manual refetch can all overlap
  // (a slow silent poll resolving after a fresh manual refetch must not
  // overwrite the newer response with older data).
  const seqRef = useRef(0);

  const fetchOverview = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    const seq = ++seqRef.current;
    try {
      if (!opts?.silent) {
        setState((prev) => (prev.items.length > 0 ? prev : { ...prev, isLoading: true, error: null }));
      }

      let items: HistoryOverviewItem[];
      if (opts?.silent || opts?.force) {
        // Silent poll or forced refetch bypasses cache read, but updates cache on success
        const res = await fetch('/api/analyses/overview', {
          method: 'GET',
          credentials: 'include',
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        items = (data.items || []) as HistoryOverviewItem[];
        setCachedQuery('history-overview', items, 5 * 60 * 1000);
      } else {
        // Initial load or normal non-silent fetch uses getCachedQuery
        items = await getCachedQuery<HistoryOverviewItem[]>(
          'history-overview',
          async () => {
            const res = await fetch('/api/analyses/overview', {
              method: 'GET',
              credentials: 'include',
            });
            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              throw new Error(errorData.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            return (data.items || []) as HistoryOverviewItem[];
          },
          { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
        );
      }

      if (cancelledRef.current || seqRef.current !== seq) return;
      setState({ items, isLoading: false, error: null });
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

  const refetch = useCallback(
    (opts?: { silent?: boolean; force?: boolean }) =>
      fetchOverview({ force: true, ...opts }),
    [fetchOverview]
  );

  return { ...state, refetch };
}
