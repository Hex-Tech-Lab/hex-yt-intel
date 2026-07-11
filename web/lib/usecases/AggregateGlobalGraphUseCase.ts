import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

/**
 * Merge incoming node into existing node: accumulate weight and deduplicate keyTerms.
 */
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
  const originTracking = new Map<string, { analysisId: string; dimension: number; weight: number }[]>();
  const sourceTracking = new Map<string, Set<string>>();

  for (const analysis of analyses) {
    for (const node of analysis.nodes) {
      // Merge key includes both label and dimension to prevent collapsing unrelated concepts
      const mergeKey = `${node.label}__dim${node.dimension}`;
      const existing = nodeMapByLabel.get(mergeKey);
      if (existing) {
        // Node with same label and dimension exists, merge it and map to existing node's ID
        mergeNode(existing, node);
        idMapping.set(node.id, existing.id);
        // Track dimensional origin
        const mergedId = existing.id;
        if (!originTracking.has(mergedId)) {
          originTracking.set(mergedId, []);
        }
        originTracking.get(mergedId)!.push({
          analysisId: analysis.id,
          dimension: node.dimension,
          weight: node.weight,
        });
        if (!sourceTracking.has(mergedId)) {
          sourceTracking.set(mergedId, new Set());
        }
        sourceTracking.get(mergedId)!.add(analysis.id);
      } else {
        // First time seeing this label+dimension combination, use original node ID as merged ID
        const mergedId = node.id;
        const mergedNode = { ...node };
        nodeMapByLabel.set(mergeKey, mergedNode);
        idMapping.set(node.id, mergedId);
        // Initialize origin tracking
        originTracking.set(mergedId, [{
          analysisId: analysis.id,
          dimension: node.dimension,
          weight: node.weight,
        }]);
        sourceTracking.set(mergedId, new Set([analysis.id]));
      }
    }
  }

  // Enhance merged nodes with dimensional provenance (Recall pattern)
  for (const node of nodeMapByLabel.values()) {
    const mergedId = node.id;
    (node as any).originDimensions = originTracking.get(mergedId) || [];
    (node as any).sourceAnalysisIds = Array.from(sourceTracking.get(mergedId) || []);
  }

  return { nodeMap: nodeMapByLabel, idMapping };
}

/**
 * Merge incoming edge into existing edge: keep maximum strength value.
 */
function mergeEdge(existing: GraphEdge, incoming: GraphEdge): void {
  existing.strength = Math.max(existing.strength, incoming.strength);
}

/**
 * Aggregate edges from multiple analyses, remapping node IDs and keeping maximum strength.
 * @param analyses - Array of analyses with edges to aggregate
 * @param idMapping - Map from original node IDs to merged node IDs
 * @returns Map of aggregated edges indexed by kind-aware key
 */
export function aggregateEdges(analyses: Array<{ id: string; edges: GraphEdge[]; nodes: GraphNode[] }>, idMapping: Map<string, string>): Map<string, GraphEdge> {
  const edgeMap = new Map<string, GraphEdge>();

  // Build label lookup for fallback edge resolution (Recall pattern)
  const nodesById = new Map<string, GraphNode>();
  for (const analysis of analyses) {
    for (const node of analysis.nodes) {
      nodesById.set(node.id, node);
    }
  }

  for (const analysis of analyses) {
    for (const edge of analysis.edges) {
      // Remap edge endpoints to merged node IDs
      const mergedSource = idMapping.get(edge.source) ?? edge.source;
      const mergedTarget = idMapping.get(edge.target) ?? edge.target;
      const edgeKey = `${mergedSource}-${mergedTarget}-${edge.kind}`;

      // Include label fallback for edge safety (allows recovery if ID resolution fails)
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      const remappedEdge: GraphEdge = {
        ...edge,
        source: mergedSource,
        target: mergedTarget,
        sourceLabel: sourceNode?.label,
        targetLabel: targetNode?.label,
      };

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
