const fs = require('fs');
let file = fs.readFileSync('web/lib/ports/TemporalKnowledgePort.ts', 'utf8');

if (!file.includes('resolveAnchorByHammingDistance')) {
  file = file.replace(
    /queryTemporalSubgraph\(params: \{/,
    `resolveAnchorByHammingDistance(params: {
    analysisId: string;
    queryHash: bigint;
    maxDistance?: number;
  }): Promise<TemporalAnchor[]>;

  queryTemporalSubgraph(params: {`
  );
  fs.writeFileSync('web/lib/ports/TemporalKnowledgePort.ts', file);
}
