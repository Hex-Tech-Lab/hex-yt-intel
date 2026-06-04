/**
 * useRelations — lazily fetches the LLM-derived stance relations (tangent/contrarian)
 * for a completed analysis. Server-cached, so this is a single cheap GET that the
 * IntelligencePanel renders alongside the lexical Related/Similar lists.
 */

import { useEffect, useState } from 'react';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

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
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(`/api/analyses/${analysisId}/relations`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!cancelled) setState({ insights: data.insights ?? [], loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ insights: [], loading: false, error: String(err?.message ?? err) });
      });

    return () => { cancelled = true; };
  }, [analysisId, enabled]);

  return state;
}
