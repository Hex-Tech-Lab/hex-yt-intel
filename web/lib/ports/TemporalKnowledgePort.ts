export interface TemporalAnchor {
  id: string;
  analysisId: string;
  windowStart: number;
  windowEnd: number;
  simhash64: bigint;
  salientClaim: string | null;
  verbatimAnchor: string | null;
}

export interface TemporalSubgraphNode extends TemporalAnchor {
  depth: number;
}

export interface TemporalKnowledgePort {
  storeSimHashAnchors(params: {
    analysisId: string;
    anchors: Omit<TemporalAnchor, 'id' | 'analysisId'>[];
  }): Promise<boolean>;

  queryTemporalSubgraph(params: {
    analysisId: string;
    entityFilter?: string[];
  }): Promise<TemporalSubgraphNode[]>;

  resolveAnchorByHammingDistance(params: {
    analysisId: string;
    targetSimHash: bigint;
    maxDistance: number;
  }): Promise<TemporalAnchor | null>;
}
