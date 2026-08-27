const fs = require('fs');
const path = 'web/lib/prompts/highlights-extraction.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(`const { start: finalStart, end, label, takeawayIdx } = item as Record<string, unknown>;`, `const { start, end, label, takeawayIdx } = item as Record<string, unknown>;`);
content = content.replace(`if (end <= start) continue;`, `if (end <= finalStart) continue;`);
content = content.replace(`if (seenStarts.has(start)) continue;`, `if (seenStarts.has(finalStart)) continue;`);
content = content.replace(`seenStarts.add(start);`, `seenStarts.add(finalStart);`);
content = content.replace(`{ start: finalStart, end: clampedEnd`, `{ start: finalStart, end: clampedEnd`); // shouldn't need a change if I replaced '{ start, '

fs.writeFileSync(path, content);
