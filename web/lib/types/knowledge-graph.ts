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

// --- ADR 026 Phase 1: grounded extraction schema (additive only, not yet wired) ---

/**
 * Where a grounded entity mention was actually found, typed per input modality.
 * `video_timestamp` is the only variant produced today (Problem A); the rest
 * exist so Problem C (multimodal ingestion) needs no future schema migration.
 */
export type GroundedLocation =
  | { type: 'video_timestamp'; seconds: number }
  | { type: 'pdf_page'; page: number; paragraph: number }
  | { type: 'audio_timestamp'; seconds: number }
  | { type: 'spreadsheet_cell'; sheet: string; column: string; row: number }
  | { type: 'text_offset'; charStart: number; charEnd: number };

/** POLE+O base entity typing (Neo4j pattern) — enables future cross-source merging (Problem B) without retrofitting existing rows. */
export type PoleOBaseType = 'Person' | 'Organization' | 'Location' | 'Event' | 'Object';

/** One real, chunk-scoped occurrence of an entity — the 1-to-many unit: a GroundedEntity has many of these. */
export interface GroundedMention {
  chunkId: string;
  location: GroundedLocation;
  matchMethod: 'exact' | 'embedding';
  matchConfidence: number;
}

/** A single canonical entity resolved across all its chunk-scoped mentions (ADR 026 §4.4 dedup). */
export interface GroundedEntity {
  id: string;
  label: string;
  baseType: PoleOBaseType;
  mentions: GroundedMention[];
}
