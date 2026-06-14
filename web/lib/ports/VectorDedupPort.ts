export interface DedupResult {
  success: boolean;
  deletedCount: number;
  error?: string;
}

export interface VectorDedupPort {
  deduplicateNodes(
    tenantId: string, 
    nodeIds: string[], 
    config: { similarityThreshold: number; maxDeletes: number }
  ): Promise<DedupResult>;
  markStale(tenantId: string, nodeIds: string[]): Promise<{ count: number }>;
}
