const fs = require('fs');
let file = 'web/lib/prompts/highlights-reconciliation.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /    if \(typeof grounded !== 'boolean'\) continue;\n    let parsedBackingIdx: number \| null = null;\n    if \(grounded\) \{\n      if \(typeof backingHighlightIdx !== 'number' \|\| !Number\.isInteger\(backingHighlightIdx\) \|\| backingHighlightIdx < 0\) \{\n        return \{ status: 'invalid' \};\n      \}\n      if \(highlightsCount !== undefined && backingHighlightIdx >= highlightsCount\) \{\n        return \{ status: 'invalid' \};\n      \}\n      parsedBackingIdx = backingHighlightIdx;\n    \} else \{\n      \/\/ Must be null if grounded is false\n      if \(backingHighlightIdx !== null && backingHighlightIdx !== undefined\) \{\n        return \{ status: 'invalid' \};\n      \}\n    \}\n    seenIdx\.add\(takeawayIdx\);\n    out\.push\(\{ idx: takeawayIdx, grounded, backingHighlightIdx: parsedBackingIdx \}\);\n  \}/;

const newBlock = `    if (typeof grounded !== 'boolean') return { status: 'invalid' };
    if (grounded && (typeof backingHighlightIdx !== 'number' || !Number.isInteger(backingHighlightIdx) || backingHighlightIdx < 0)) return { status: 'invalid' };
    if (grounded && highlightsCount !== undefined && backingHighlightIdx >= highlightsCount) return { status: 'invalid' };
    if (!grounded && backingHighlightIdx != null) return { status: 'invalid' };
    
    seenIdx.add(takeawayIdx);
    out.push({ idx: takeawayIdx, grounded, backingHighlightIdx: grounded ? (backingHighlightIdx as number) : null });
  }`;

if (regex.test(content)) {
  content = content.replace(regex, newBlock);
  fs.writeFileSync(file, content);
  console.log('Parser refactored');
} else {
  console.log('Regex failed');
}
