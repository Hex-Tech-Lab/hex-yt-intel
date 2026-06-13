export interface VectorDedupPort {
  deduplicateNodes(tenantId: string, nodeIds: string[]): Promise<{ count: number }>;
  markStale(tenantId: string, nodeIds: string[]): Promise<{ count: number }>;
}
