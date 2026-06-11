import { useEffect, useState } from 'react';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

// See /docs/hooks/use-relations.md

interface RelationsState {
  insights: RelationInsight[];
  loading: boolean;
  error: string | null;
}

// Module-level cache mapping analysisId -> insights
const relationsCache = new Map<string, RelationInsight[]>();
// Module-level in-flight requests mapping analysisId -> Promise of insights
const inFlightRequests = new Map<string, Promise<RelationInsight[]>>();

export function useRelations(analysisId: string | null, enabled: boolean): RelationsState {
  const [state, setState] = useState<RelationsState>(() => {
    if (analysisId && relationsCache.has(analysisId)) {
      return { insights: relationsCache.get(analysisId)!, loading: false, error: null };
    }
    return { insights: [], loading: false, error: null };
  });

  useEffect(() => {
    if (!analysisId || !enabled) {
      setState({ insights: [], loading: false, error: null });
      return;
    }

    // Resolve from cache immediately if present
    if (relationsCache.has(analysisId)) {
      setState({ insights: relationsCache.get(analysisId)!, loading: false, error: null });
      return;
    }

    let isMounted = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    let promise = inFlightRequests.get(analysisId);
    if (!promise) {
      promise = fetch(`/api/analyses/${analysisId}/relations`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const insights = data.insights ?? [];
          relationsCache.set(analysisId, insights);
          inFlightRequests.delete(analysisId);
          return insights;
        })
        .catch((err) => {
          inFlightRequests.delete(analysisId);
          throw err;
        });
      inFlightRequests.set(analysisId, promise);
    }

    promise
      .then((insights) => {
        if (isMounted) {
          setState({ insights, loading: false, error: null });
        }
      })
      .catch((err) => {
        if (isMounted) {
          setState({ insights: [], loading: false, error: String(err?.message ?? err) });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [analysisId, enabled]);

  return state;
}

