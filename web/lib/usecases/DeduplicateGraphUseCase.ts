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

    // 4. Deduplicate
    await this.vectorDedupPort.deduplicateNodes(tenantId, nodeIds);
    
    console.log(`[DeduplicateGraphUseCase] Deduplication completed for tenant: ${tenantId}, analysis: ${analysisId}`);
  }
}
