export interface DedupResult {
  success: boolean;
  deletedCount: number;
  deletedNodeIds: string[]; // Track which node IDs were deleted for cascading edge cleanup
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
