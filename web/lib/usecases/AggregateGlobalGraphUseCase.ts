import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

export class AggregateGlobalGraphUseCase {
  async execute(analyses: Array<{ id: string; nodes: GraphNode[]; edges: GraphEdge[] }>): Promise<KnowledgeGraph> {
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    for (const analysis of analyses) {
      // Aggregate Nodes
      for (const node of analysis.nodes) {
        const existingNode = nodeMap.get(node.label);
        if (existingNode) {
          // Merge logic: accumulate weight, update content if relevant
          existingNode.weight += node.weight;
          if (node.keyTerms.length > existingNode.keyTerms.length) {
            existingNode.keyTerms = [...new Set([...existingNode.keyTerms, ...node.keyTerms])];
          }
        } else {
          nodeMap.set(node.label, { ...node });
        }
      }

      // Aggregate Edges (simplified: just track unique pairs)
      for (const edge of analysis.edges) {
        // Need to find nodes by label if source/target are node IDs rather than labels, 
        // but based on types, let's assume labels or need to map IDs.
        // Assuming edge source/target are labels for this reduction logic.
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
