import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

namespace AggregateGraphHelpers {
  /**
   * Merge node weights and keyTerms when the same node ID appears in multiple analyses.
   * Node identity is determined by stable ID, not label.
   */
  function mergeNode(existing: GraphNode, incoming: GraphNode): void {
    existing.weight += incoming.weight;
    existing.keyTerms = [...new Set([...existing.keyTerms, ...incoming.keyTerms])];
  }

  /**
   * Aggregate all nodes from multiple analyses into a single map,
   * keyed by stable node ID.
   */
  export function aggregateNodes(analyses: Array<{ id: string; nodes: GraphNode[] }>): Map<string, GraphNode> {
    const nodeMap = new Map<string, GraphNode>();
    for (const analysis of analyses) {
      for (const node of analysis.nodes) {
        const existing = nodeMap.get(node.id);
        if (existing) {
          mergeNode(existing, node);
        } else {
          nodeMap.set(node.id, { ...node });
        }
      }
    }
    return nodeMap;
  }

  /**
   * Merge edge strength when the same edge (source-target-kind) appears in multiple analyses.
   */
  function mergeEdge(existing: GraphEdge, incoming: GraphEdge): void {
    existing.strength = Math.max(existing.strength, incoming.strength);
  }

  /**
   * Aggregate all edges from multiple analyses into a single map,
   * keyed by (source, target, kind) triplet.
   */
  export function aggregateEdges(analyses: Array<{ id: string; edges: GraphEdge[] }>): Map<string, GraphEdge> {
    const edgeMap = new Map<string, GraphEdge>();
    for (const analysis of analyses) {
      for (const edge of analysis.edges) {
        const edgeKey = `${edge.source}-${edge.target}-${edge.kind}`;
        const existing = edgeMap.get(edgeKey);
        if (existing) {
          mergeEdge(existing, edge);
        } else {
          edgeMap.set(edgeKey, { ...edge });
        }
      }
    }
    return edgeMap;
  }

  /**
   * Validate edges: drop any edge whose source or target node doesn't exist
   * (orphan edges). Returns only edges with both endpoints present.
   */
  export function validateEdges(edges: GraphEdge[], nodeMap: Map<string, GraphNode>): GraphEdge[] {
    return Array.from(edges).filter(edge => {
      const hasSource = nodeMap.has(edge.source);
      const hasTarget = nodeMap.has(edge.target);
      if (!hasSource || !hasTarget) {
        console.warn('[KG] Dropping orphan edge', {
          source: edge.source,
          target: edge.target,
          reason: `missing ${!hasSource ? 'source' : 'target'} node`,
        });
      }
      return hasSource && hasTarget;
    });
  }
}

/**
 * Aggregates knowledge graph nodes and edges from multiple analyses.
 * Merges duplicate nodes by ID, deduplicates edges by (source, target, kind) triplet,
 * and validates edges to drop orphan references.
 */
export class AggregateGlobalGraphUseCase {
  /**
   * Execute the aggregation use case.
   * @param analyses - Array of analyses, each with nodes and edges to aggregate
   * @returns A consolidated knowledge graph with merged nodes and validated edges
   */
  execute(analyses: Array<{ id: string; nodes: GraphNode[]; edges: GraphEdge[] }>): KnowledgeGraph {
    const nodeMap = AggregateGraphHelpers.aggregateNodes(analyses);
    const edgeMap = AggregateGraphHelpers.aggregateEdges(analyses);
    const validatedEdges = AggregateGraphHelpers.validateEdges(Array.from(edgeMap.values()), nodeMap);

    return {
      nodes: Array.from(nodeMap.values()),
      edges: validatedEdges,
      rootId: null
    };
  }
}
