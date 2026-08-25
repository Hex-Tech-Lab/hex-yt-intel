const fs = require('fs');

let content = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');

if (!content.includes('TemporalKnowledgePort')) {
  // Add imports
  content = "import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';\nimport { computeSimHash64 } from '@/lib/utils/simhash';\n" + content;
  
  // Update constructor
  content = content.replace(
    /private completion: TextCompletionPort\n  \) \{\}/,
    "private completion: TextCompletionPort,\n    private temporalGraph?: TemporalKnowledgePort\n  ) {}"
  );
  
  // Add anchor generation after saveHighlights
  const saveBlock = /    await this\.persistence\.saveHighlights\(\{\n      analysisId,\n      highlights: result\.highlights\.map\(\(highlight, idx\) => \(\{\n        idx,\n        start: highlight\.start,\n        end: highlight\.end,\n        label: highlight\.label,\n        takeawayIdx: highlight\.takeawayIdx \?\? null,\n        verbatimExcerpt: buildVerbatimExcerpt\(highlight\.start, highlight\.end, segments\),\n      \}\)\),\n    \}\);\n/;
  
  const simHashBlock = `
    // ADR 028: Ingest Temporal Anchors (30s micro-windows)
    if (this.temporalGraph && segments.length > 0) {
      const anchors = [];
      const windowSize = 30;
      const maxTime = segments[segments.length - 1].start;
      for (let windowStart = 0; windowStart <= maxTime; windowStart += windowSize) {
        const windowEnd = windowStart + windowSize;
        const windowSegments = segments.filter(s => s.start >= windowStart && s.start < windowEnd);
        if (windowSegments.length > 0) {
          const tokens = windowSegments.map(s => s.text).join(' ').split(/\\s+/).filter(Boolean);
          const simhash64 = computeSimHash64(tokens);
          anchors.push({ windowStart, windowEnd, simhash64, salientClaim: null, verbatimAnchor: null });
        }
      }
      if (anchors.length > 0) {
        await this.temporalGraph.storeSimHashAnchors({ analysisId, anchors });
      }
    }
`;

  content = content.replace(saveBlock, saveBlock.source ? saveBlock.source.replace(/\\/g, '').replace(/\)\;/g, ');\n' + simHashBlock) : (saveBlock.toString().slice(1, -1) + simHashBlock));
  
  // Wait, string replacement of Regex matches:
  content = content.replace(/    await this\.persistence\.saveHighlights\(\{[\s\S]*?\}\);/, match => match + simHashBlock);
  fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', content);
}
console.log('ExtractHighlightsUseCase updated');
