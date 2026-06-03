/**
 * KnowledgeGraphSynthesizer (worker) — thin re-export of the shared, isomorphic
 * implementation in web/lib so the graph math has a single source of truth.
 *
 * The full algorithm (TF-IDF similarity → edges → centrality → root) lives in
 * `web/lib/intelligence/knowledge-graph.ts` and is bundled by esbuild. The live
 * graph is computed client-side today; this worker-side entry exists for a future
 * server-side precompute (e.g., persisting the graph alongside the analysis, or
 * swapping in an Upstash Vector / embeddings SimilarityEngine).
 */

export {
  KnowledgeGraphSynthesizer,
  nodeIntelligence,
} from '../../../web/lib/intelligence/knowledge-graph';

export { TfIdfSimilarityEngine } from '../../../web/lib/intelligence/similarity';
export type { SimilarityEngine } from '../../../web/lib/intelligence/similarity';
export type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  NodeIntelligence,
} from '../../../web/lib/types/knowledge-graph';
