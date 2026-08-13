/**
 * Highlights extraction -- timestamped keypoints for the auto-scrubber
 * (docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md).
 * Runs in the same pass as the executive digest, while the source transcript
 * is still within its 72h retention window (ADR 012) -- this is the only
 * place real segment timing exists.
 */

export const HIGHLIGHTS_EXTRACTION_SYSTEM_PROMPT =
  `You extract the most noteworthy moments from a video transcript for a highlights reel. You are given transcript segments, each with a start time in seconds and its spoken text. Select the moments a viewer researching this video would most want to see -- claims, reveals, pricing/numbers mentioned, strong opinions, key demonstrations -- not filler, greetings, or transitions.

Output ONLY a JSON array, no prose before or after, no markdown code fence. Each element: {"start": <number, seconds, MUST exactly match a segment's start time from the input -- never invent or interpolate a timestamp>, "end": <number, seconds, the end of the relevant span -- the start of the next selected segment or a later segment's start if the point continues>, "label": <string, one short sentence describing what happens at this moment>}.

Select between 4 and 12 moments depending on video length and density -- fewer for short/sparse videos, more for long/dense ones. Never fabricate a timestamp that isn't one of the given segment start times. If the transcript is too short or has no distinct noteworthy moments, return an empty array [].`;

export function buildHighlightsExtractionUserMessage(segments: Array<{ start: number; text: string }>): string {
  const lines = segments.map((segment) => `[${segment.start}] ${segment.text}`).join('\n');
  return `Transcript segments (start time in seconds, then text):\n\n${lines}`;
}

export interface ExtractedHighlight {
  start: number;
  end: number;
  label: string;
}

const MAX_HIGHLIGHTS = 12;
const MAX_LABEL_LENGTH = 200;

/**
 * 'invalid' (couldn't parse a JSON array at all) is a DISTINCT outcome from
 * 'ok' with an empty highlights array (the model genuinely found nothing
 * noteworthy) -- the caller must never delete an existing highlight set on
 * 'invalid' (a transient LLM/parse failure), only ever replace it on 'ok'
 * (a structurally valid response, empty or not). Conflating these two was a
 * real data-loss bug caught in review: a malformed response would silently
 * wipe a previously-extracted, still-valid highlight set.
 */
export type HighlightsExtractionResult =
  | { status: 'invalid' }
  | { status: 'ok'; highlights: ExtractedHighlight[] };

/**
 * Parses the model's JSON array response, dropping any entry that doesn't
 * match a real segment start time (guards against a hallucinated timestamp
 * slipping through despite the prompt instruction) or is otherwise malformed.
 * De-dupes by start (keeps the first), sorts by start, and caps at
 * MAX_HIGHLIGHTS -- defensive limits even though the prompt already asks for
 * this shape, since a bad model response shouldn't be trusted to self-limit.
 */
export function parseHighlightsExtraction(
  text: string,
  validSegmentStarts: ReadonlySet<number>
): HighlightsExtractionResult {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { status: 'invalid' };

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    console.warn('[highlights-extraction] model response matched a JSON-array shape but failed to parse:', parseError);
    return { status: 'invalid' };
  }
  if (!Array.isArray(raw)) return { status: 'invalid' };

  const seenStarts = new Set<number>();
  const out: ExtractedHighlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { start, end, label } = item as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof label !== 'string') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!validSegmentStarts.has(start)) continue;
    // end must also be a real segment start, matching the prompt's own
    // contract ("the start of the next selected segment or a later
    // segment's start") -- an arbitrary numeric end is exactly the kind of
    // interpolated/fabricated timestamp the prompt explicitly forbids.
    if (!validSegmentStarts.has(end)) continue;
    if (end <= start) continue;
    if (seenStarts.has(start)) continue;
    const rawLabel = label.trim();
    const trimmedLabel = rawLabel.length > MAX_LABEL_LENGTH ? `${rawLabel.slice(0, MAX_LABEL_LENGTH)}...` : rawLabel;
    if (trimmedLabel.length === 0) continue;
    seenStarts.add(start);
    out.push({ start, end, label: trimmedLabel });
  }

  out.sort((left, right) => left.start - right.start);
  while (out.length > MAX_HIGHLIGHTS) out.pop(); // cap item count, not a string-display truncation
  return { status: 'ok', highlights: out };
}
