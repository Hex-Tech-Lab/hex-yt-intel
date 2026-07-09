import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

export class AggregateGlobalGraphUseCase {
  execute(analyses: Array<{ id: string; nodes: GraphNode[]; edges: GraphEdge[] }>): KnowledgeGraph {
    const nodesById = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    const allEdges: GraphEdge[] = [];

    // First pass: collect all nodes (prevents orphaned edges from cross-analysis references)
    for (const analysis of analyses) {
      for (const node of analysis.nodes) {
        const existingNode = nodesById.get(node.id);
        if (existingNode) {
          existingNode.weight += node.weight;
          if (node.keyTerms.length > existingNode.keyTerms.length) {
            existingNode.keyTerms = [...new Set([...existingNode.keyTerms, ...node.keyTerms])];
          }
        } else {
          nodesById.set(node.id, { ...node });
        }
      }
    }

    // Second pass: collect edges (now that all nodes are known)
    for (const analysis of analyses) {
      for (const edge of analysis.edges) {
        allEdges.push(edge);
      }
    }

    // Third pass: validate and aggregate edges against the complete node map
    for (const edge of allEdges) {
      // Verify both source and target node IDs exist in the aggregated graph
      const sourceExists = nodesById.has(edge.source);
      const targetExists = nodesById.has(edge.target);

      // Only add edge if both referenced nodes exist (prevent orphaned edges)
      if (sourceExists && targetExists) {
        const edgeKey = `${edge.source}-${edge.target}-${edge.kind}`;
        const existingEdge = edgeMap.get(edgeKey);
        if (existingEdge) {
          existingEdge.strength = Math.max(existingEdge.strength, edge.strength);
        } else {
          edgeMap.set(edgeKey, { ...edge });
        }
      }
    }

    return {
      nodes: Array.from(nodesById.values()),
      edges: Array.from(edgeMap.values()),
      rootId: null
    };
  }
}
