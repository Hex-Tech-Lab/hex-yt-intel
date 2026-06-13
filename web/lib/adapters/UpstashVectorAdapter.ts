import { Index } from '@upstash/vector';
import { VectorDedupPort } from '@/lib/ports/VectorDedupPort';

export class UpstashVectorAdapter implements VectorDedupPort {
  private index: Index;

  constructor(url: string, token: string) {
    this.index = new Index({ url, token });
  }

  async deduplicateNodes(tenantId: string, nodeIds: string[]): Promise<{ count: number }> {
    const ns = this.index.namespace(tenantId);
    let deletedCount = 0;

    for (const id of nodeIds) {
      const vectorData = await ns.fetch([id]);
      if (vectorData && vectorData[0] && vectorData[0].vector) {
        const results = await ns.query({
          vector: vectorData[0].vector as number[],
          topK: 5,
          includeMetadata: true
        });

        for (const res of results) {
          if (res.id !== id && typeof res.score === 'number' && res.score > 0.99) {
            await ns.delete([String(res.id)]);
            deletedCount++;
          }
        }
      }
    }
    console.log(`[UpstashVectorAdapter] Deduplicated ${deletedCount} nodes for tenant: ${tenantId}`);
    return { count: deletedCount };
  }

  async markStale(tenantId: string, nodeIds: string[]): Promise<{ count: number }> {
    const ns = this.index.namespace(tenantId);
    for (const id of nodeIds) {
      const vectorData = await ns.fetch([id]);
      if (vectorData && vectorData[0] && vectorData[0].vector) {
        await ns.upsert({
          id: id,
          vector: vectorData[0].vector as number[],
          metadata: { ...vectorData[0].metadata, stale: true }
        });
      }
    }
    console.log(`[UpstashVectorAdapter] Marked ${nodeIds.length} nodes stale for tenant: ${tenantId}`);
    return { count: nodeIds.length };
  }
}
