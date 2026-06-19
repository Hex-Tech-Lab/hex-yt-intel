import type { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

export interface GraphPersistencePort {
  persistKnowledgeGraph(params: {
    analysisId: string;
    entities: Array<{
      label: string;
      type: string;
      weight: number;
      rawNode?: any;
    }>;
    relations: Array<{
      source: string;
      target: string;
      relation: string;
      strength: number;
      rawEdge?: any;
    }>;
  }): Promise<void>;

  getKnowledgeGraph(analysisId: string): Promise<{
    entities: Array<{ id: string; label: string; type: string; weight: number; raw_node?: any }>;
    relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number; raw_edge?: any }>;
  } | null>;

  getAnalysesByTenant(tenantId: string): Promise<Array<{ id: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>>;

  persistGraph(params: { analysisId: string; nodes: GraphNode[]; relations: GraphEdge[] }): Promise<void>;

  getGraph(analysisId: string): Promise<{ nodes: GraphNode[]; relations: GraphEdge[] } | null>;
}
