import { GraphNode, GraphEdge, KnowledgeGraph } from '@/lib/types/knowledge-graph';

/**
 * Canonicalize label to prevent collisions from formatting differences.
 * Normalizes case, whitespace, and punctuation to create stable merge keys.
 * Converts to lowercase, trims leading/trailing spaces, and deduplicates internal spaces.
 * @param label - Raw label string to canonicalize
 * @returns Normalized canonical form suitable for merge key generation
 */
function canonicalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Compute semantic similarity via keyTerm overlap using Jaccard index.
 * Measures concept relatedness across dimensions by comparing keyword sets.
 * Returns 0-1 where 1 means identical terms, 0 means no overlap.
 * @param termsA - First set of key terms
 * @param termsB - Second set of key terms
 * @returns Jaccard similarity coefficient (0-1)
 */
function computeTermOverlap(termsA: string[], termsB: string[]): number {
  if (!termsA.length || !termsB.length) return 0;
  const setA = new Set(termsA.map(t => t.toLowerCase()));
  const setB = new Set(termsB.map(t => t.toLowerCase()));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Determine if two same-label nodes should merge across dimensions.
 * Implements Recall pattern: same dimension always merges; different dimensions merge if >70% keyTerm overlap.
 * Prevents cross-dimensional concept collapse while allowing legitimate semantic merges.
 * Reserved for future cross-dimension collision detection enhancement.
 * @param existingNode - Node already in the aggregate graph
 * @param incomingNode - Node being considered for merge
 * @returns True if nodes should be merged, false to keep separate
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function shouldMergeNodes(existingNode: GraphNode, incomingNode: GraphNode): boolean {
  if (existingNode.dimension === incomingNode.dimension) return true;
  const overlap = computeTermOverlap(existingNode.keyTerms, incomingNode.keyTerms);
  return overlap > 0.7;
}

/**
 * Merge incoming node into existing node.
 * Accumulates weight and deduplicates keyTerms to preserve semantic information.
 * @param existing - Target node to merge into
 * @param incoming - Source node to merge from
 */
function mergeNode(existing: GraphNode, incoming: GraphNode): void {
  existing.weight += incoming.weight;
  existing.keyTerms = [...new Set([...existing.keyTerms, ...incoming.keyTerms])];
}

/**
 * Aggregate nodes from multiple analyses, merging by label across analyses.
 * Applies label canonicalization to prevent collisions from formatting differences.
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
      // Canonicalize label and merge key: includes both label and dimension to prevent collapsing unrelated concepts
      const canonicalLabel = canonicalizeLabel(node.label);
      const mergeKey = `${canonicalLabel}__dim${node.dimension}`;
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
        const mergedNode = { ...node, label: canonicalLabel };
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
 * Merge incoming edge into existing edge.
 * Preserves the maximum relationship strength across analyses.
 * @param existing - Target edge to merge into
 * @param incoming - Source edge to merge from
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
 * Prevents orphan edges that would break graph traversal and visualization.
 * Logs warnings for dropped edges to aid in debugging aggregation issues.
 * @param edges - Edges to validate
 * @param nodesByLabel - Map of valid nodes indexed by merged node ID
 * @returns Array of edges with valid source and target nodes present in the graph
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
   * Execute the aggregation use case to merge multiple analyses into a global knowledge graph.
   * Applies label canonicalization, dimension-aware merging, and edge validation.
   * Preserves node provenance (originDimensions, sourceAnalysisIds) for lineage tracking.
   * @param analyses - Array of analyses, each with nodes and edges to aggregate
   * @returns A consolidated knowledge graph with merged nodes, remapped edges, and provenance metadata
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
