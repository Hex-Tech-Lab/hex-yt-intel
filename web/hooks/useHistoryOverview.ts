import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { getCachedQuery, peekCachedQuery, setCachedQuery } from '@/lib/utils/client-cache';

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
 * Uses client-cache with 5-minute TTL scoped to the authenticated userId for initial
 * mount and tab-switch caching, while allowing background polling when live status
 * items exist. Fences setCachedQuery by request sequence to prevent stale overwrites.
 */
export function useHistoryOverview(overrideUserId?: string) {
  const { user } = useAuth();
  const userId = overrideUserId ?? user?.id;
  const cacheKey = userId ? `history-overview:${userId}` : null;

  const cached = cacheKey ? peekCachedQuery<HistoryOverviewItem[]>(cacheKey) : undefined;
  const [state, setState] = useState<HistoryOverviewState>({
    items: cached ?? [],
    isLoading: Boolean(userId && !cached),
    error: null,
  });
  const cancelledRef = useRef(false);
  // Monotonic request sequence: only the most recently STARTED fetch may
  // settle state or update the cache.
  const seqRef = useRef(0);
  const userIdRef = useRef<string | undefined>(userId);
  userIdRef.current = userId;

  const fetchOverview = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) return;
    const activeCacheKey = `history-overview:${activeUserId}`;

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

        // Sequence fencing: only cache if this response belongs to the latest request generation
        if (!cancelledRef.current && seqRef.current === seq) {
          setCachedQuery(activeCacheKey, items, 5 * 60 * 1000);
        }
      } else {
        // Initial load or normal non-silent fetch uses getCachedQuery
        items = await getCachedQuery<HistoryOverviewItem[]>(
          activeCacheKey,
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
      console.error('[useHistoryOverview]', err);
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
    } finally {
      if (!cancelledRef.current && seqRef.current === seq && !opts?.silent) {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!userId) {
      setState({ items: [], isLoading: false, error: null });
      return;
    }
    void fetchOverview();
    return () => {
      cancelledRef.current = true;
    };
  }, [userId, fetchOverview]);

  const hasLive = hasLiveStatusItems(state.items);

  useEffect(() => {
    if (!hasLive || !userId) return;
    const pollId = setInterval(() => {
      void fetchOverview({ silent: true });
    }, HISTORY_LIVE_POLL_MS);
    return () => clearInterval(pollId);
  }, [hasLive, userId, fetchOverview]);

  const refetch = useCallback(
    (opts?: { silent?: boolean; force?: boolean }) =>
      fetchOverview({ force: true, ...opts }),
    [fetchOverview]
  );

  return { ...state, refetch };
}
