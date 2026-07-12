import * as Sentry from '@sentry/nextjs';
import { GraphPersistencePort } from '@/lib/ports';
import { VectorDedupPort } from '@/lib/ports/VectorDedupPort';
import type { GraphEdge } from '@/lib/types/knowledge-graph';

/**
 * Deduplicates knowledge graph nodes and cascades deletion to related edges.
 * Removes similar nodes above threshold and persists cleaned graph.
 */
export class DeduplicateGraphUseCase {
  constructor(
    private graphPort: GraphPersistencePort,
    private vectorDedupPort: VectorDedupPort
  ) {}

  /**
   * Execute deduplication: identify duplicate nodes, remove them, and cascade-delete orphaned edges.
   * @param tenantId - Tenant identifier for vector store operations
   * @param analysisId - Analysis containing the graph to deduplicate
   */
  async execute(tenantId: string, analysisId: string): Promise<void> {
    // 1. Fetch graph
    const graph = await this.graphPort.getGraph(analysisId);
    if (!graph || graph.nodes.length === 0) return;

    // 2. Identify stale/duplicate nodes (placeholder logic)
    const nodeIds = graph.nodes.map(n => n.id);

    // 3. Mark stale in Upstash
    await this.vectorDedupPort.markStale(tenantId, nodeIds);

    // 4. Deduplicate with safety thresholds
    const result = await this.vectorDedupPort.deduplicateNodes(tenantId, nodeIds, {
      similarityThreshold: 0.95,
      maxDeletes: 50
    });

    if (!result.success) {
      console.error('[DeduplicateGraphUseCase]', {
        message: 'Deduplication failed',
        tenantId,
        analysisId,
        error: result.error,
      });
      return;
    }

    // 5. Cascade-delete edges that reference deleted nodes
    if (result.deletedNodeIds && result.deletedNodeIds.length > 0) {
      const deletedSet = new Set(result.deletedNodeIds);
      const relations = graph.relations || [];
      const cleanedEdges = relations.filter((edge: GraphEdge) => {
        const sourceDeleted = deletedSet.has(edge.source);
        const targetDeleted = deletedSet.has(edge.target);
        if (sourceDeleted || targetDeleted) {
          console.warn('[DeduplicateGraphUseCase] Cascading edge deletion for removed node', {
            source: edge.source,
            target: edge.target,
            reason: `${sourceDeleted ? 'source' : 'target'} node was deduplicated`,
          });
        }
        return !sourceDeleted && !targetDeleted;
      });

      const cleanedNodes = graph.nodes.filter(n => !deletedSet.has(n.id));

      // Persist cleaned graph (nodes + edges without orphans)
      try {
        await this.graphPort.persistGraph({
          analysisId,
          nodes: cleanedNodes,
          relations: cleanedEdges,
        });

        console.info('[DeduplicateGraphUseCase] Edge cleanup completed', {
          tenant: tenantId,
          analysis: analysisId,
          deletedNodes: result.deletedCount,
          deletedEdges: relations.length - cleanedEdges.length,
        });
      } catch (error) {
        Sentry.captureException(error, {
          contexts: {
            deduplicateGraph: {
              tenantId,
              analysisId,
              deletedNodeIds: result.deletedNodeIds,
            },
          },
        });
        console.error('[DeduplicateGraphUseCase]', {
          message: 'Failed to persist cleaned graph after deduplication',
          tenantId,
          analysisId,
          deletedNodeIds: result.deletedNodeIds,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      console.info('[DeduplicateGraphUseCase] Deduplication completed', {
        tenant: tenantId,
        analysis: analysisId,
        deleted: result.deletedCount,
      });
    }
  }
}
