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

/**
 * Fetch relation insights for an analysis with streaming support and deduplication.
 * Caches results and deduplicates in-flight requests for the same analysisId.
 * Supports both JSON responses and Server-Sent Events streaming.
 * @param analysisId The analysis ID to fetch relations for, or null to disable
 * @param enabled Whether to fetch (allows conditional disabling)
 * @returns State object with insights array, loading flag, and error string
 */
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
      promise = (async () => {
        const res = await fetch(`/api/analyses/${analysisId}/relations`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          const insights = data.insights ?? [];
          relationsCache.set(analysisId, insights);
          inFlightRequests.delete(analysisId);
          return insights;
        }

        if (!res.body) throw new Error('No response body');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let insights: RelationInsight[] = [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const parsed = JSON.parse(line.slice(5).trim());
              if (parsed.type === 'insight' && parsed.insight) {
                insights.push(parsed.insight);
                if (isMounted) {
                  setState({ insights: [...insights], loading: true, error: null });
                }
              } else if (parsed.type === 'complete' && parsed.insights) {
                insights = parsed.insights;
              }
            } catch {
              /* partial */
            }
          }
        }

        relationsCache.set(analysisId, insights);
        inFlightRequests.delete(analysisId);
        return insights;
      })().catch((err) => {
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

