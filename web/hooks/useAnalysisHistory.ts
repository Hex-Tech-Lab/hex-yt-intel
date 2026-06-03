import { useEffect, useState } from 'react';

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

export function useAnalysisHistory() {
  const [state, setState] = useState<HistoryState>({
    items: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        const res = await fetch('/api/analyses', {
          method: 'GET',
          credentials: 'include',
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        setState({
          items: data.analyses || [],
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load history',
        }));
      }
    };

    fetchHistory();
  }, []);

  return state;
}
