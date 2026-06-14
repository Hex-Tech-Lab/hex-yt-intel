import { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

/** @deprecated Use PersistencePort instead. */
export interface GraphRAGPort {
  /** @deprecated Use PersistencePort.persistKnowledgeGraph instead. */
  persistGraph(params: {
    analysisId: string;
    nodes: GraphNode[];
    relations: GraphEdge[];
  }): Promise<void>;
  
  /** @deprecated Use PersistencePort.getKnowledgeGraph instead. */
  getGraph(analysisId: string): Promise<{
    nodes: GraphNode[];
    relations: GraphEdge[];
  } | null>;
}
