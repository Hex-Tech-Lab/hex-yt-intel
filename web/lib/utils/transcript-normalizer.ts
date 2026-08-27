export interface NormalizedSegment {
  start: number;
  text: string;
}

export function normalizeTranscriptSegments(rawSegments: unknown[] | null | undefined): NormalizedSegment[] | null {
  if (!rawSegments || !Array.isArray(rawSegments)) return null;

  const seenStarts = new Set<number>();
  const normalized = rawSegments
    .map((s: any) => {
      if (!s) return null;
      const rawStart = s.start;
      let start: number;
      if (typeof rawStart === "number" && Number.isFinite(rawStart)) {
        start = rawStart;
      } else if (typeof rawStart === "string" && rawStart.trim() !== "" && !isNaN(Number(rawStart))) {
        start = Number(rawStart);
      } else {
        return null;
      }
      if (!Number.isFinite(start) || start < 0) return null;
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
