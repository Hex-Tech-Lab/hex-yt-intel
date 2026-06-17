import type { PersonaId } from './persona';

// See /docs/types/knowledge-graph.md

export interface GraphNode {
  id: string;
  dimension: number;
  label: string;
  content: string;
  weight: number;
  polarity: number;
  keyTerms: string[];
  inPersona: boolean;
  entityType?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  strength: number;
  kind: RelationKind;
}

export type RelationKind = 'similar' | 'related' | 'tangent' | 'contrarian';

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string | null;
}

export interface NodeIntelligence {
  nodeId: string;
  related: RelatedRef[];
  similar: RelatedRef[];
  tangents: RelatedRef[];
  contrarian: RelatedRef[];
  isFoundational: boolean;
}

export interface RelatedRef {
  nodeId: string;
  dimension: number;
  label: string;
  strength: number;
}

export interface SynthesisInput {
  dimensions: Array<{ number: number; name: string; content: string }>;
  personaDimensions?: number[];
  persona?: PersonaId;
}

export interface RelationInsight {
  kind: 'tangent' | 'contrarian';
  source: number;
  target: number;
  sourceLabel: string;
  targetLabel: string;
  rationale: string;
}

export interface RelationsResult {
  analysisId: string;
  generatedAt: string;
  model: string;
  insights: RelationInsight[];
}
