export interface VectorDedupPort {
  deduplicateNodes(tenantId: string, nodeIds: string[]): Promise<void>;
  markStale(tenantId: string, nodeIds: string[]): Promise<void>;
}
