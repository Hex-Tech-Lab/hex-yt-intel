export interface NormalizedSegment {
  start: number;
  text: string;
}

export function normalizeTranscriptSegments(rawSegments: unknown[] | null | undefined): NormalizedSegment[] | null {
  if (!rawSegments || !Array.isArray(rawSegments)) return null;

  const seenStarts = new Set<number>();
  const normalized = rawSegments
    .filter((s: any) => typeof s?.start === 'number' && typeof s?.text === 'string' && Number.isFinite(s.start) && s.start >= 0 && s.text.trim().length > 0)
    .map((s: any) => ({ start: s.start as number, text: s.text.trim() as string }))
    .filter((s) => {
      if (seenStarts.has(s.start)) return false;
      seenStarts.add(s.start);
      return true;
    })
    .sort((left, right) => left.start - right.start);
    
  return normalized.length > 0 ? normalized : null;
}
