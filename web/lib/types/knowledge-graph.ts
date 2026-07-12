import type { PersonaId } from './persona';

// See /docs/types/knowledge-graph.md

/**
 * Represents a semantic entity extracted from video analysis.
 * Each node belongs to a dimension and carries weight, sentiment, and related terms.
 * Aggregated across dimensions to build the global knowledge graph.
 */
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

/**
 * Represents a directed relationship between two nodes in the knowledge graph.
 * Kind indicates the semantic relationship type; strength reflects confidence/weight.
 * Optional endpoint labels provide fallback display names for edge endpoint navigation.
 */
export interface GraphEdge {
  source: string;
  target: string;
  strength: number;
  kind: RelationKind;
  sourceLabel?: string;
  targetLabel?: string;
}

/**
 * Extended node type tracking provenance and origins after merging/deduplication.
 * Preserves dimensional origin for recall and metadata reconstruction.
 */
export interface MergedGraphNode extends GraphNode {
  originDimensions?: Array<{
    analysisId: string;
    dimension: number;
    weight: number;
  }>;
  sourceAnalysisIds?: string[];
}

/** Semantic relationship type: similar (strong semantic match), related (general connection), tangent (topic shift), contrarian (opposing viewpoint). */
export type RelationKind = 'similar' | 'related' | 'tangent' | 'contrarian';

/**
 * Complete knowledge graph representing semantic relationships and entities from analysis.
 * Built from multiple dimensions and used for visualization, chat grounding, and intelligence.
 */
export interface KnowledgeGraph {
  nodes: MergedGraphNode[];
  edges: GraphEdge[];
  rootId: string | null;
}

/**
 * Intelligence payload for a selected node including all related, similar, tangent, and contrarian references.
 * Used by IntelligencePanel to provide contextual relationship exploration.
 */
export interface NodeIntelligence {
  nodeId: string;
  related: RelatedRef[];
  similar: RelatedRef[];
  tangents: RelatedRef[];
  contrarian: RelatedRef[];
  isFoundational: boolean;
}

/** Lightweight reference to a related node with relationship strength for ranking. */
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
