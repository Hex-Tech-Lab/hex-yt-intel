const fs = require('fs');
const path = 'web/lib/utils/transcript-normalizer.ts';
let content = fs.readFileSync(path, 'utf8');

const helper = `function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const num = Number(raw.trim());
    if (Number.isFinite(num) && num >= 0) {
      return num;
    }
  }
  return null;
}

`;

const oldMap = `      if (!s) return null;
      const rawStart = s.start;
      let start: number;
      if (typeof rawStart === "number" && Number.isFinite(rawStart)) {
        start = rawStart;
      } else if (typeof rawStart === "string" && rawStart.trim() !== "" && !isNaN(Number(rawStart))) {
        start = Number(rawStart);
      } else {
        return null;
      }
      if (!Number.isFinite(start) || start < 0) return null;`;

const newMap = `      if (!s) return null;
      const start = parseTimestamp(s.start);
      if (start === null) return null;`;

if (!content.includes('parseTimestamp')) {
  content = content.replace('export function normalizeTranscriptSegments', helper + 'export function normalizeTranscriptSegments');
}
content = content.replace(oldMap, newMap);
fs.writeFileSync(path, content);
