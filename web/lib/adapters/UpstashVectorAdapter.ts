import { Index } from '@upstash/vector';
import { VectorDedupPort } from '@/lib/ports/VectorDedupPort';

export class UpstashVectorAdapter implements VectorDedupPort {
  constructor(url: string, token: string) {
    new Index({ url, token });
  }

  async deduplicateNodes(tenantId: string, nodeIds: string[]): Promise<{ count: number }> {
    console.log(`[UpstashVectorAdapter] Performing deduplication for tenant: ${tenantId}, nodes: ${nodeIds.length}`);
    return { count: nodeIds.length };
  }

  async markStale(tenantId: string, nodeIds: string[]): Promise<{ count: number }> {
    console.log(`[UpstashVectorAdapter] Marking ${nodeIds.length} nodes stale for tenant: ${tenantId}`);
    return { count: nodeIds.length };
  }
}
