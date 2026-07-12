import { useState, useEffect } from 'react';
import { KnowledgeGraph } from '@/lib/types/knowledge-graph';

/**
 * Fetch the global knowledge graph from the Atlas service.
 * Loads on mount and provides loading and error states.
 * @returns Global knowledge graph, loading state, and any error
 */
export function useGlobalGraph() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGraph() {
      try {
        const response = await fetch('/api/atlas/global-graph');
        if (!response.ok) {
          throw new Error('Failed to fetch global knowledge graph');
        }
        const data: KnowledgeGraph = await response.json();
        setGraph(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchGraph();
  }, []);

  return { graph, loading, error };
}
