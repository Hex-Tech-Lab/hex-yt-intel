import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryOverviewItem } from '@/lib/ports';

interface HistoryOverviewState {
  items: HistoryOverviewItem[];
  isLoading: boolean;
  error: string | null;
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
 */
export function useHistoryOverview() {
  const [state, setState] = useState<HistoryOverviewState>({
    items: [],
    isLoading: true,
    error: null,
  });
  const cancelledRef = useRef(false);

  const fetchOverview = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      const res = await fetch('/api/analyses/overview', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (cancelledRef.current) return;
      setState({ items: data.items || [], isLoading: false, error: null });
    } catch (err) {
      if (cancelledRef.current) return;
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

  return { ...state, refetch: fetchOverview };
}
