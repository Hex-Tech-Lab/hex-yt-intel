import type { UCISDimension } from '@/lib/types/synthesis-nucleus';

// Matches "### DIMENSION N - NAME" headers (en/em dash, hyphen, or colon separator),
// mirroring the worker's StreamingDimensionParser so a persisted report rehydrates
// identically to a live stream.
const DIMENSION_HEADER = /###\s+DIMENSION\s+(\d+)\s*[-–—:]\s*([^\n]+)/g;

/**
 * Parse a persisted UCIS markdown report into the dimension map the synthesis nucleus
 * consumes (`Record<number, UCISDimension>`).
 *
 * Used by the bouncer cache-hit path: the cached row stores raw markdown, but the UI
 * grid reads dimensions from the nucleus — which is otherwise only populated by the
 * live streaming parser. Without this, a cache hit renders an empty grid ("hollow done
 * state"). Returns {} for empty/unparseable input; callers gate on the count (>=8
 * dimensions = a genuine analysis, matching the worker's validate12D threshold).
 */
export function parseUcisDimensions(markdown: string): Record<number, UCISDimension> {
  const out: Record<number, UCISDimension> = {};
  if (!markdown || !markdown.trim()) return out;

  const matches = [...markdown.matchAll(DIMENSION_HEADER)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m) continue;

    const number = parseInt(m[1] ?? '', 10);
    if (Number.isNaN(number) || number < 1 || number > 11) continue;

    const name = (m[2] ?? '').trim();
    const contentStart = (m.index ?? 0) + (m[0] ?? '').length;
    const contentEnd = matches[i + 1]?.index ?? markdown.length;
    const content = markdown.slice(contentStart, contentEnd).trim();

    out[number] = { number, name, content };
  }
  return out;
}
