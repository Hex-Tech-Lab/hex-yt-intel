const fs = require('fs');

let content = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');

// I'll just rewrite the bad line
content = content.replace(
  /await this\.persistence\.saveHighlights\(\{n.*/,
  `await this.persistence.saveHighlights({
      analysisId,
      highlights: result.highlights.map((highlight, idx) => ({
        idx,
        start: highlight.start,
        end: highlight.end,
        label: highlight.label,
        takeawayIdx: highlight.takeawayIdx ?? null,
        verbatimExcerpt: buildVerbatimExcerpt(highlight.start, highlight.end, segments),
      })),
    });

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
    }`
);

fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', content);
console.log('Fixed extract usecase');
