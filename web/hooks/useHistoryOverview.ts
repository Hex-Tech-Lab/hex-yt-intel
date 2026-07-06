import { useEffect, useState } from 'react';
import type { HistoryOverviewItem } from '@/lib/ports';

interface HistoryOverviewState {
  items: HistoryOverviewItem[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches the video-centric history overview — one aggregated row per underlying
 * video (archived re-runs collapsed) — from GET /api/analyses/overview.
 */
export function useHistoryOverview() {
  const [state, setState] = useState<HistoryOverviewState>({
    items: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
        if (cancelled) return;
        setState({ items: data.items || [], isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load history',
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
