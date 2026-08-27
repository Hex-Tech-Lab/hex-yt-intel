const fs = require('fs');
const path = 'web/lib/prompts/highlights-extraction.ts';
let content = fs.readFileSync(path, 'utf8');

const helper = `function findNearestSegmentStart(targetTime: number, availableStarts: Iterable<number>, maxEpsilon = 1.0): number | null {
  let closest: number | null = null;
  let minDiff = Infinity;
  for (const segStart of availableStarts) {
    const diff = Math.abs(segStart - targetTime);
    if (diff <= maxEpsilon && diff < minDiff) {
      minDiff = diff;
      closest = segStart;
    }
  }
  return closest;
}

`;

const oldLogic = `    // fuzzy match for floating point differences (epsilon = 1.0s)
    let matchedStart: number | null = null;
    let minDiff = Infinity;
    for (const validStart of validSegmentStarts) {
      const diff = Math.abs(validStart - start);
      if (diff <= 1.0 && diff < minDiff) {
        minDiff = diff;
        matchedStart = validStart;
      }
    }`;

const newLogic = `    const matchedStart = findNearestSegmentStart(start, validSegmentStarts, 1.0);`;

if (!content.includes('findNearestSegmentStart')) {
  content = content.replace('export function buildHighlightsExtractionSystemPrompt', helper + 'export function buildHighlightsExtractionSystemPrompt');
}
content = content.replace(oldLogic, newLogic);
fs.writeFileSync(path, content);
