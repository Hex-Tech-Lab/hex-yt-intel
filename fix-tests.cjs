const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', 'utf8');

// Add the missing mock to the second test
file = file.replace(
  /const temporalGraph: TemporalKnowledgePort = \{\n\s*storeSimHashAnchors: vi\.fn\(\),\n\s*queryTemporalSubgraph: vi\.fn\(\)\.mockResolvedValue\(\[\n/,
  `const temporalGraph: TemporalKnowledgePort = {
      storeSimHashAnchors: vi.fn(),
      resolveAnchorByHammingDistance: vi.fn().mockResolvedValue([]),
      queryTemporalSubgraph: vi.fn().mockResolvedValue([\n`
);

fs.writeFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', file);
