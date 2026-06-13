import { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

export interface GraphRAGPort {
  persistGraph(params: {
    analysisId: string;
    nodes: GraphNode[];
    relations: GraphEdge[];
  }): Promise<void>;
  
  getGraph(analysisId: string): Promise<{
    nodes: GraphNode[];
    relations: GraphEdge[];
  } | null>;
}
