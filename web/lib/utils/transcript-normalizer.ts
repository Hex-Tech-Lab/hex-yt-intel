export interface NormalizedSegment {
  start: number;
  text: string;
}

function parseTimestamp(raw: unknown): number | null {
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

export function normalizeTranscriptSegments(rawSegments: unknown[] | null | undefined): NormalizedSegment[] | null {
  if (!rawSegments || !Array.isArray(rawSegments)) return null;

  const seenStarts = new Set<number>();
  const normalized = rawSegments
    .map((s: any) => {
      if (!s) return null;
      const start = parseTimestamp(s.start);
      if (start === null) return null;
      if (typeof s.text !== 'string' || s.text.trim().length === 0) return null;
      return { start, text: s.text.trim() };
    })
    .filter((s: NormalizedSegment | null): s is NormalizedSegment => s !== null)
    .filter((s) => {
      if (seenStarts.has(s.start)) return false;
      seenStarts.add(s.start);
      return true;
    })
    .sort((left, right) => left.start - right.start);
    
  return normalized.length > 0 ? normalized : null;
}
