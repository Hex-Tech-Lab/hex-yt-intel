/**
 * Knowledge Graph domain types
 *
 * Derived view over a completed UCIS analysis: nodes are dimensions, edges are
 * semantic relationships computed by a SimilarityEngine. This is the data model
 * the force-graph canvas + intelligence panel render.
 */

import type { PersonaId } from './synthesis-nucleus';

/** A dimension rendered as a graph node. */
export interface GraphNode {
  /** Stable id = `dim-<number>` */
  id: string;
  /** Dimension number (1-11) */
  dimension: number;
  /** Display label */
  label: string;
  /** Full dimension content (for the intelligence panel) */
  content: string;
  /** Computed importance score 0..1 (weighted-degree centrality, normalized) */
  weight: number;
  /** Sentiment polarity -1..1 (heuristic; drives contrarian detection) */
  polarity: number;
  /** Top distinctive terms (TF-IDF), for card context */
  keyTerms: string[];
  /** True if this dimension is in the active persona's projection */
  inPersona: boolean;
}

/** A weighted, typed relationship between two dimensions. */
export interface GraphEdge {
  /** Source node id */
  source: string;
  /** Target node id */
  target: string;
  /** Cosine similarity 0..1 */
  strength: number;
  /** Relationship classification (drives edge style + which card it feeds) */
  kind: RelationKind;
}

/**
 * Relationship classes:
 * - similar:     near-duplicate framing (very high similarity)
 * - related:     shares core concepts (high similarity)
 * - tangent:     adjacent but divergent (moderate band)
 * - contrarian:  topically connected but opposite polarity (heuristic)
 */
export type RelationKind = 'similar' | 'related' | 'tangent' | 'contrarian';

/** The complete graph. */
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node id of the most central dimension (highest weight). */
  rootId: string | null;
}

/** Per-node relationship breakdown surfaced in the intelligence panel. */
export interface NodeIntelligence {
  nodeId: string;
  related: RelatedRef[];
  similar: RelatedRef[];
  tangents: RelatedRef[];
  contrarian: RelatedRef[];
  /** Is this the foundational (root) node of the synthesis? */
  isFoundational: boolean;
}

/** A reference to another node within a relationship list. */
export interface RelatedRef {
  nodeId: string;
  dimension: number;
  label: string;
  strength: number;
}

/** Persona-aware context passed to the synthesizer. */
export interface SynthesisInput {
  dimensions: Array<{ number: number; name: string; content: string }>;
  /** Dimension numbers visible in the active persona (for node.inPersona). */
  personaDimensions?: number[];
  persona?: PersonaId;
}
