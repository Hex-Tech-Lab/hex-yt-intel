import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

function mergeNode(existing: GraphNode, incoming: GraphNode): void {
  existing.weight += incoming.weight;
  existing.keyTerms = [...new Set([...existing.keyTerms, ...incoming.keyTerms])];
}

/**
 * Aggregate nodes from multiple analyses, merging weight and keyTerms.
 * @param analyses - Array of analyses with nodes to aggregate
 * @returns Map of aggregated nodes indexed by ID
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

function mergeEdge(existing: GraphEdge, incoming: GraphEdge): void {
  existing.strength = Math.max(existing.strength, incoming.strength);
}

/**
 * Aggregate edges from multiple analyses, keeping maximum strength.
 * @param analyses - Array of analyses with edges to aggregate
 * @returns Map of aggregated edges indexed by kind-aware key
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
 * Validate edges by filtering out those referencing non-existent nodes.
 * @param edges - Edges to validate
 * @param nodeMap - Map of valid nodes by ID
 * @returns Array of edges with valid source and target nodes
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

export class AggregateGlobalGraphUseCase {
  /**
   * Execute the aggregation use case.
   * @param analyses - Array of analyses, each with nodes and edges to aggregate
   * @returns A consolidated knowledge graph with merged nodes and validated edges
   */
  execute(analyses: Array<{ id: string; nodes: GraphNode[]; edges: GraphEdge[] }>): KnowledgeGraph {
    const nodeMap = aggregateNodes(analyses);
    const edgeMap = aggregateEdges(analyses);
    const validatedEdges = validateEdges(Array.from(edgeMap.values()), nodeMap);

    return {
      nodes: Array.from(nodeMap.values()),
      edges: validatedEdges,
      rootId: null
    };
  }
}
