import { GraphRAGPort } from '@/lib/ports/GraphRAGPort';
import { VectorDedupPort } from '@/lib/ports/VectorDedupPort';

export class DeduplicateGraphUseCase {
  constructor(
    private graphPort: GraphRAGPort,
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
    } else {
      console.log(`[DeduplicateGraphUseCase] Deduplication completed for tenant: ${tenantId}, analysis: ${analysisId}, deleted: ${result.deletedCount}`);
    }
  }
}
