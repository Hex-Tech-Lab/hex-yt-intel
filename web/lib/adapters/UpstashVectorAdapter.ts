import { Index } from '@upstash/vector';
import { VectorDedupPort, DedupResult } from '@/lib/ports/VectorDedupPort';

interface QueryResult {
  id: string;
  score?: number | string;
  metadata?: Record<string, any>;
  vector?: number[];
}

export class UpstashVectorAdapter implements VectorDedupPort {
  private index: Index;

  constructor(url: string, token: string) {
    this.index = new Index({ url, token });
  }

  async deduplicateNodes(
    tenantId: string,
    nodeIds: string[],
    config: { similarityThreshold: number; maxDeletes: number }
  ): Promise<DedupResult> {
    const ns = this.index.namespace(tenantId);
    const deletedNodeIds: string[] = [];
    let deletedCount = 0;

    try {
      for (const id of nodeIds) {
        const vectorData = await ns.fetch([id]);
        if (vectorData && vectorData[0] && vectorData[0].vector) {
          const results = (await ns.query({
            vector: vectorData[0].vector as number[],
            topK: 5,
            includeMetadata: true
          })) as QueryResult[];

          for (const res of results) {
            const score = typeof res.score === 'string' ? parseFloat(res.score) : res.score;
            if (res.id !== id && typeof score === 'number' && score >= config.similarityThreshold) {
              if (deletedCount >= config.maxDeletes) {
                console.warn(`[UpstashVectorAdapter] Max deletion limit reached: ${config.maxDeletes}`);
                return { success: true, deletedCount, deletedNodeIds, error: 'Max deletion limit reached' };
              }
              await ns.delete([res.id]);
              deletedNodeIds.push(res.id);
              deletedCount++;
            }
          }
        }
      }
      return { success: true, deletedCount, deletedNodeIds };
    } catch (error) {
      console.error('[UpstashVectorAdapter] DeduplicateNodes failed:', error);
      return { success: false, deletedCount, deletedNodeIds, error: 'Deduplication operation failed' };
    }
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
