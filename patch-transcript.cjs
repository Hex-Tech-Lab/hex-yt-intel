const fs = require('fs');
const path = 'web/lib/utils/transcript-normalizer.ts';
let content = fs.readFileSync(path, 'utf8');

const newCode = `    .map((s: any) => {
      if (!s) return null;
      const start = typeof s.start === 'number' ? s.start : Number(s.start);
      if (!Number.isFinite(start) || start < 0) return null;
      if (typeof s.text !== 'string' || s.text.trim().length === 0) return null;
      return { start, text: s.text.trim() };
    })
    .filter((s: NormalizedSegment | null): s is NormalizedSegment => s !== null)`;

content = content.replace(/    \.filter\(\(s: any\) => typeof s\?\.start === 'number' && typeof s\?\.text === 'string' && Number\.isFinite\(s\.start\) && s\.start >= 0 && s\.text\.trim\(\)\.length > 0\)\n    \.map\(\(s: any\) => \(\{ start: s\.start as number, text: s\.text\.trim\(\) as string \}\)\)/, newCode);

fs.writeFileSync(path, content);
