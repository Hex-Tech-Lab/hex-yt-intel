import { useState, useEffect } from 'react';
import { KnowledgeGraph } from '@/lib/types/knowledge-graph';

export function useGlobalGraph() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGraph() {
      try {
        const response = await fetch('/api/wiki/global-graph');
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
