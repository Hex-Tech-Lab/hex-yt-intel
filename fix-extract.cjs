const fs = require('fs');
let file = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');

// Remove the old anchor logic at the bottom
file = file.replace(/if \(this\.temporalGraph && segments\.length > 0\) \{[\s\S]*?\}\s*\}\s*\}\s*$/m, '  }\n}');

// Insert the new anchor logic before `if (result.highlights.length === 0) return;`
const newAnchorLogic = `
    // Generate SimHash anchors *before* saving highlights or returning on empty,
    // so a DB failure here prevents highlights from saving, allowing webhook retries
    // to actually retry the whole operation rather than skipping.
    if (this.temporalGraph && segments.length > 0) {
      const anchors = [];
      const windowSize = 30;
      const maxTime = Math.max(...segments.map((s) => s.start));
      for (let windowStart = 0; windowStart <= maxTime; windowStart += windowSize) {
        const windowEnd = windowStart + windowSize;
        const windowSegments = segments.filter(
          (s) => s.start >= windowStart && s.start < windowEnd
        );
        if (windowSegments.length > 0) {
          const rawText = windowSegments.map((s) => s.text).join(' ');
          const tokens = rawText.split(/\\s+/).filter(Boolean);
          const simhash64 = computeSimHash64(tokens);
          
          // Store bounded verbatim anchor (max 200 chars) for policy-compliant grounding
          const verbatimAnchor = rawText.slice(0, 200);
          
          anchors.push({ 
            windowStart, 
            windowEnd, 
            simhash64, 
            salientClaim: null, 
            verbatimAnchor 
          });
        }
      }
      if (anchors.length > 0) {
        const success = await this.temporalGraph.storeSimHashAnchors({ analysisId, anchors });
        if (!success) {
          throw new Error('Failed to persist temporal simhash anchors');
        }
      }
    }

    if (result.highlights.length === 0) return;`;

file = file.replace(/if \(result\.highlights\.length === 0\) return;/, newAnchorLogic);
fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', file);
