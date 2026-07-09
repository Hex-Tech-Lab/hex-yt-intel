import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

export class AggregateGlobalGraphUseCase {
  execute(analyses: Array<{ id: string; nodes: GraphNode[]; edges: GraphEdge[] }>): KnowledgeGraph {
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    for (const analysis of analyses) {
      // Aggregate Nodes: key by stable ID (e.g., dim-5) not label, so same conceptual
      // node (identified by ID) merges across analyses, but nodes with different IDs
      // (even if labeled the same) remain distinct.
      for (const node of analysis.nodes) {
        const existingNode = nodeMap.get(node.id);
        if (existingNode) {
          existingNode.weight += node.weight;
          if (node.keyTerms.length > existingNode.keyTerms.length) {
            existingNode.keyTerms = [...new Set([...existingNode.keyTerms, ...node.keyTerms])];
          }
        } else {
          nodeMap.set(node.id, { ...node });
        }
      }

      // Aggregate Edges: key by canonical node IDs (source/target are already node IDs,
      // not labels). This ensures edges are merged correctly after node aggregation.
      for (const edge of analysis.edges) {
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
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
      rootId: null
    };
  }
}
