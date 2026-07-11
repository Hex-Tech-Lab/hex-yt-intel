import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

function mergeNode(existing: GraphNode, incoming: GraphNode): void {
  existing.weight += incoming.weight;
  existing.keyTerms = [...new Set([...existing.keyTerms, ...incoming.keyTerms])];
}

/**
 * Aggregate nodes from multiple analyses, merging by label across analyses.
 * Creates a stable mapping from original node IDs to merged node IDs.
 * @param analyses - Array of analyses with nodes to aggregate
 * @returns Object with nodeMap (aggregated nodes by label) and idMapping (original ID → merged ID)
 */
export function aggregateNodes(analyses: Array<{ id: string; nodes: GraphNode[] }>): { nodeMap: Map<string, GraphNode>; idMapping: Map<string, string> } {
  const nodeMapByLabel = new Map<string, GraphNode>();
  const idMapping = new Map<string, string>();
  let nextMergedId = 0;

  for (const analysis of analyses) {
    for (const node of analysis.nodes) {
      const existing = nodeMapByLabel.get(node.label);
      if (existing) {
        // Node with same label exists, merge it
        mergeNode(existing, node);
        // Map original ID to the merged node's ID
        idMapping.set(node.id, existing.id);
      } else {
        // First time seeing this label, create merged node with stable ID
        const mergedId = `merged-node-${nextMergedId++}`;
        const mergedNode = { ...node, id: mergedId };
        nodeMapByLabel.set(node.label, mergedNode);
        idMapping.set(node.id, mergedId);
      }
    }
  }
  return { nodeMap: nodeMapByLabel, idMapping };
}

function mergeEdge(existing: GraphEdge, incoming: GraphEdge): void {
  existing.strength = Math.max(existing.strength, incoming.strength);
}

/**
 * Aggregate edges from multiple analyses, remapping node IDs and keeping maximum strength.
 * @param analyses - Array of analyses with edges to aggregate
 * @param idMapping - Map from original node IDs to merged node IDs
 * @returns Map of aggregated edges indexed by kind-aware key
 */
export function aggregateEdges(analyses: Array<{ id: string; edges: GraphEdge[] }>, idMapping: Map<string, string>): Map<string, GraphEdge> {
  const edgeMap = new Map<string, GraphEdge>();
  for (const analysis of analyses) {
    for (const edge of analysis.edges) {
      // Remap edge endpoints to merged node IDs
      const mergedSource = idMapping.get(edge.source) ?? edge.source;
      const mergedTarget = idMapping.get(edge.target) ?? edge.target;
      const edgeKey = `${mergedSource}-${mergedTarget}-${edge.kind}`;
      const remappedEdge = { ...edge, source: mergedSource, target: mergedTarget };
      const existing = edgeMap.get(edgeKey);
      if (existing) {
        mergeEdge(existing, remappedEdge);
      } else {
        edgeMap.set(edgeKey, remappedEdge);
      }
    }
  }
  return edgeMap;
}

/**
 * Validate edges by filtering out those referencing non-existent nodes.
 * @param edges - Edges to validate
 * @param nodesByLabel - Map of valid nodes keyed by label
 * @returns Array of edges with valid source and target nodes
 */
export function validateEdges(edges: GraphEdge[], nodesByLabel: Map<string, GraphNode>): GraphEdge[] {
  // Create a reverse map: merged node ID → node for faster lookup
  const nodesById = new Map<string, GraphNode>();
  for (const node of nodesByLabel.values()) {
    nodesById.set(node.id, node);
  }

  return Array.from(edges).filter(edge => {
    const hasSource = nodesById.has(edge.source);
    const hasTarget = nodesById.has(edge.target);
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
    const { nodeMap, idMapping } = aggregateNodes(analyses);
    const edgeMap = aggregateEdges(analyses, idMapping);
    const validatedEdges = validateEdges(Array.from(edgeMap.values()), nodeMap);

    return {
      nodes: Array.from(nodeMap.values()),
      edges: validatedEdges,
      rootId: null
    };
  }
}
