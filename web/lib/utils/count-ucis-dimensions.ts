import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/**
 * Strip a leading ```lang fence and its trailing ``` if the string is a fenced
 * code block (analyses are frequently persisted as a ```json fenced payload).
 */
function stripCodeFence(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  const firstNewline = t.indexOf('\n');
  let body = firstNewline === -1 ? '' : t.slice(firstNewline + 1);
  const trimmedEnd = body.trimEnd();
  if (trimmedEnd.endsWith('```')) body = trimmedEnd.slice(0, -3);
  return body.trim();
}

/**
 * The present UCIS dimension numbers (1..{@link TOTAL_DIMENSIONS}), sorted and
 * deduped, from EITHER storage format an analysis can be persisted in:
 *
 *  - a ```json-fenced UCISPayload whose `dimensions` array carries one object
 *    per dimension (each with a `number`), OR
 *  - stitched "### DIMENSION N" markdown headers.
 *
 * This is the single source of truth for "how many dimensions does this analysis
 * actually have" — the `### DIMENSION` parser alone silently returns 0 for the
 * JSON format, which caused the reaper to fail salvageable analyses and the
 * history overview to mislabel completed analyses.
 */
export function parseUcisDimensionNumbers(markdown: string | null | undefined): number[] {
  if (!markdown || !markdown.trim()) return [];

  const stripped = stripCodeFence(markdown);
  if (stripped.startsWith('{')) {
    try {
      const payload = JSON.parse(stripped) as { dimensions?: unknown };
      if (Array.isArray(payload.dimensions)) {
        const nums = new Set<number>();
        for (const d of payload.dimensions) {
          const n = Number((d as { number?: unknown })?.number);
          if (Number.isInteger(n) && n >= 1 && n <= TOTAL_DIMENSIONS) nums.add(n);
        }
        return [...nums].sort((a, b) => a - b);
      }
    } catch {
      // Not valid JSON (e.g. a truncated stuck row) — fall back to markdown.
    }
  }

  return Object.keys(parseUcisDimensions(markdown))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_DIMENSIONS)
    .sort((a, b) => a - b);
}

/** Count of present UCIS dimensions across either storage format. */
export function countUcisDimensions(markdown: string | null | undefined): number {
  return parseUcisDimensionNumbers(markdown).length;
}
