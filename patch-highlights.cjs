const fs = require('fs');
const path = 'web/lib/prompts/highlights-extraction.ts';
let content = fs.readFileSync(path, 'utf8');

const fuzzyMatcher = `    // fuzzy match for floating point differences (epsilon = 1.0s)
    let matchedStart: number | null = null;
    for (const validStart of validSegmentStarts) {
      if (Math.abs(validStart - start) <= 1.0) {
        matchedStart = validStart;
        break;
      }
    }
    if (matchedStart === null) continue;
    const finalStart = matchedStart;`;

content = content.replace(`if (!validSegmentStarts.has(start)) continue;`, fuzzyMatcher);
content = content.replace(/const duration = end - start;/g, `const duration = end - finalStart;`);
content = content.replace(/start \+ minSegmentDurationSeconds/g, `finalStart + minSegmentDurationSeconds`);
content = content.replace(/start \+ maxSegmentDurationSeconds/g, `finalStart + maxSegmentDurationSeconds`);
content = content.replace(/\{ start, /g, `{ start: finalStart, `);

fs.writeFileSync(path, content);
