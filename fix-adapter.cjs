const fs = require('fs');
let content = fs.readFileSync('web/lib/adapters/SupabaseAnalysisAdapter.ts', 'utf8');

if (!content.includes('normalizeTranscriptSegments')) {
  content = "import { normalizeTranscriptSegments } from '@/lib/utils/transcript-normalizer';\n" + content;
  content = content.replace(
    /      if \(\!data\?\.segments \|\| \!Array\.isArray\(data\.segments\)\) return null;\n\n      const seenStarts = new Set<number>\(\);\n      return \(data\.segments as unknown\[\]\)\n        \.filter\(\(s: any\) => typeof s\?\.start === 'number' && typeof s\?\.text === 'string' && Number\.isFinite\(s\.start\) && s\.start >= 0 && s\.text\.trim\(\)\.length > 0\)\n        \.map\(\(s: any\) => \(\{ start: s\.start as number, text: s\.text\.trim\(\) as string \}\)\)\n        \.filter\(\(s\) => \{\n          if \(seenStarts\.has\(s\.start\)\) return false;\n          seenStarts\.add\(s\.start\);\n          return true;\n        \}\)\n        \.sort\(\(left, right\) => left\.start - right\.start\);/g,
    "      return normalizeTranscriptSegments(data?.segments);"
  );
  fs.writeFileSync('web/lib/adapters/SupabaseAnalysisAdapter.ts', content);
}
console.log('Adapter fixed');
