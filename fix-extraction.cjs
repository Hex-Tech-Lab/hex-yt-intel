const fs = require('fs');
let ext = fs.readFileSync('web/lib/prompts/highlights-extraction.ts', 'utf8');
ext = "import { parseJsonArray } from '@/lib/utils/json-parser';\n" + ext;
ext = ext.replace(
  /const jsonMatch = text\.match\(\/\\\[\[\\s\\S\]\*\\\]\/\);\n  if \(\!jsonMatch\) return \{ status: 'invalid' \};\n\n  let raw: unknown;\n  try \{\n    raw = JSON\.parse\(jsonMatch\[0\]\);\n  \} catch \(parseError\) \{\n    console\.warn\('\[highlights-extraction\] model response matched a JSON-array shape but failed to parse:', parseError\);\n    return \{ status: 'invalid' \};\n  \}/,
  "const parseResult = parseJsonArray(text, 'highlights-extraction');\n  if (parseResult.status === 'invalid') return { status: 'invalid' };\n  const raw = parseResult.data;"
);
fs.writeFileSync('web/lib/prompts/highlights-extraction.ts', ext);

let rec = fs.readFileSync('web/lib/prompts/highlights-reconciliation.ts', 'utf8');
rec = "import { parseJsonArray } from '@/lib/utils/json-parser';\n" + rec;
rec = rec.replace(
  /const jsonMatch = rawText\.match\(\/\\\[\[\\s\\S\]\*\\\]\/\);\n  if \(\!jsonMatch\) return \{ status: 'invalid' \};\n\n  let raw: unknown;\n  try \{\n    raw = JSON\.parse\(jsonMatch\[0\]\);\n  \} catch \(parseError\) \{\n    console\.warn\('\[highlights-reconciliation\] model response matched a JSON-array shape but failed to parse:', parseError instanceof Error \? parseError\.message : String\(parseError\)\);\n    return \{ status: 'invalid' \};\n  \}/,
  "const parseResult = parseJsonArray(rawText, 'highlights-reconciliation');\n  if (parseResult.status === 'invalid') return { status: 'invalid' };\n  const raw = parseResult.data;"
);
fs.writeFileSync('web/lib/prompts/highlights-reconciliation.ts', rec);

console.log('Parsers replaced');
