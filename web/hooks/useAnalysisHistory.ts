import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCachedQuery, peekCachedQuery } from '@/lib/utils/client-cache';

export interface HistoryItem {
  id: string;
  videoId: string;
  title: string;
  createdAt: string;
  status: 'completed' | 'processing' | 'incomplete';
}

interface HistoryState {
  items: HistoryItem[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch and manage the user's analysis history from the server.
 * Automatically loads on mount and handles loading/error states.
 * Uses client-cache with 5-minute TTL scoped to the authenticated userId.
 * @returns Object with items (analysis history), isLoading, and error state
 */
export function useAnalysisHistory(overrideUserId?: string) {
  const { user } = useAuth();
  const userId = overrideUserId ?? user?.id;
  const cacheKey = userId ? `analysis-history:${userId}` : null;

  const cached = cacheKey ? peekCachedQuery<HistoryItem[]>(cacheKey) : undefined;
  const [state, setState] = useState<HistoryState>({
    items: cached ?? [],
    isLoading: Boolean(userId && !cached),
    error: null,
  });

  useEffect(() => {
    // If no authenticated user, bypass cache and do not issue query
    if (!userId || !cacheKey) {
      setState({ items: [], isLoading: false, error: null });
      return;
    }

    let cancelled = false;

    const fetchHistory = async () => {
      try {
        if (!cached) {
          setState((prev) => ({ ...prev, isLoading: true, error: null }));
        }

        const items = await getCachedQuery<HistoryItem[]>(
          cacheKey,
          async () => {
            const res = await fetch('/api/analyses', {
              method: 'GET',
              credentials: 'include',
            });

            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              throw new Error(errorData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            return (data.analyses || []) as HistoryItem[];
          },
          { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
        );

        if (!cancelled) {
          setState({
            items,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        console.error('[useAnalysisHistory]', err);
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load history',
          }));
        }
      } finally {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    };

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [userId, cacheKey, cached]);

  return state;
}
