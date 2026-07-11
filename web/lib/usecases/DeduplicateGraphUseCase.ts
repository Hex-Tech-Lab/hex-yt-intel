import { GraphPersistencePort } from '@/lib/ports';
import { VectorDedupPort } from '@/lib/ports/VectorDedupPort';

export class DeduplicateGraphUseCase {
  constructor(
    private graphPort: GraphPersistencePort,
    private vectorDedupPort: VectorDedupPort
  ) {}

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
      console.error(`[DeduplicateGraphUseCase] Deduplication failed for tenant: ${tenantId}, analysis: ${analysisId}, error: ${result.error}`);
      return;
    }

    // 5. Cascade-delete edges that reference deleted nodes
    if (result.deletedNodeIds && result.deletedNodeIds.length > 0) {
      const deletedSet = new Set(result.deletedNodeIds);
      const cleanedEdges = graph.relations.filter(edge => {
        // Normalize edge endpoints: handle both string IDs and possible object references
        const source = typeof edge.source === 'string' ? edge.source : edge.source?.id ?? '';
        const target = typeof edge.target === 'string' ? edge.target : edge.target?.id ?? '';

        const sourceDeleted = deletedSet.has(source);
        const targetDeleted = deletedSet.has(target);
        if (sourceDeleted || targetDeleted) {
          console.log(`[DeduplicateGraphUseCase] Cascading edge deletion for removed node`, {
            source,
            target,
            reason: `${sourceDeleted ? 'source' : 'target'} node was deduplicated`,
          });
        }
        return !sourceDeleted && !targetDeleted;
      });

      const cleanedNodes = graph.nodes.filter(n => !deletedSet.has(n.id));

      // Persist cleaned graph (nodes + edges without orphans)
      await this.graphPort.persistGraph({
        analysisId,
        nodes: cleanedNodes,
        relations: cleanedEdges,
      });

      console.log(`[DeduplicateGraphUseCase] Edge cleanup completed`, {
        tenant: tenantId,
        analysis: analysisId,
        deletedNodes: result.deletedCount,
        deletedEdges: graph.relations.length - cleanedEdges.length,
      });
    } else {
      console.log(`[DeduplicateGraphUseCase] Deduplication completed for tenant: ${tenantId}, analysis: ${analysisId}, deleted: ${result.deletedCount}`);
    }
  }
}
