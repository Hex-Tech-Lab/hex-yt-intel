import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

function mergeNode(existing: GraphNode, incoming: GraphNode): void {
  existing.weight += incoming.weight;
  existing.keyTerms = [...new Set([...existing.keyTerms, ...incoming.keyTerms])];
}

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
