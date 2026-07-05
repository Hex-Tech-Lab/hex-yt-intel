import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/**
 * Strip a leading ```lang fence and its trailing ``` if the string is a fenced
 * code block (analyses are frequently persisted as a ```json fenced payload).
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  let body = firstNewline === -1 ? '' : trimmed.slice(firstNewline + 1);
  const trimmedEnd = body.trimEnd();
  if (trimmedEnd.endsWith('```')) body = trimmedEnd.slice(0, -3);
  return body.trim();
}

/**
 * The dimension numbers carried by a ```json / bare-JSON UCISPayload, or null if
 * the text is not a JSON object with a `dimensions` array (so the caller can
 * fall back to markdown parsing).
 */
function jsonDimensionNumbers(text: string): number[] | null {
  if (!text.startsWith('{')) return null;
  let payload: { dimensions?: unknown };
  try {
    payload = JSON.parse(text) as { dimensions?: unknown };
  } catch (err) {
    // Truncated/invalid JSON (e.g. a partially-streamed stuck row). Log and let
    // the caller fall back to markdown rather than silently returning nothing.
    console.debug('[count-ucis-dimensions] JSON parse failed, using markdown fallback:', err instanceof Error ? err.message : err);
    return null;
  }
  if (!Array.isArray(payload.dimensions)) return null;
  const nums = new Set<number>();
  for (const dim of payload.dimensions) {
    const n = Number((dim as { number?: unknown })?.number);
    if (Number.isInteger(n) && n >= 1 && n <= TOTAL_DIMENSIONS) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * The present UCIS dimension numbers (1..{@link TOTAL_DIMENSIONS}), sorted and
 * deduped, from EITHER storage format an analysis can be persisted in:
 *
 *  - a ```json-fenced UCISPayload whose `dimensions` array carries one object
 *    per dimension (each with a `number`), OR
 *  - stitched "### DIMENSION N" markdown headers.
 *
 * Single source of truth for "how many dimensions does this analysis actually
 * have" — the `### DIMENSION` parser alone silently returns 0 for the JSON
 * format, which caused the reaper to fail salvageable analyses and the history
 * overview to mislabel completed analyses.
 */
export function parseUcisDimensionNumbers(markdown: string | null | undefined): number[] {
  if (!markdown || !markdown.trim()) return [];

  const fromJson = jsonDimensionNumbers(stripCodeFence(markdown));
  if (fromJson) return fromJson;

  return Object.keys(parseUcisDimensions(markdown))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_DIMENSIONS)
    .sort((a, b) => a - b);
}

/** Count of present UCIS dimensions across either storage format. */
export function countUcisDimensions(markdown: string | null | undefined): number {
  return parseUcisDimensionNumbers(markdown).length;
}
