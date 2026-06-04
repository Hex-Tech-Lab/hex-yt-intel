import { useEffect, useState } from 'react';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

// See /docs/hooks/use-relations.md

interface RelationsState {
  insights: RelationInsight[];
  loading: boolean;
  error: string | null;
}

export function useRelations(analysisId: string | null, enabled: boolean): RelationsState {
  const [state, setState] = useState<RelationsState>({ insights: [], loading: false, error: null });

  useEffect(() => {
    if (!analysisId || !enabled) {
      setState({ insights: [], loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(`/api/analyses/${analysisId}/relations`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setState({ insights: data.insights ?? [], loading: false, error: null });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ insights: [], loading: false, error: String(err?.message ?? err) });
      });

    return () => {
      controller.abort();
    };
  }, [analysisId, enabled]);

  return state;
}
