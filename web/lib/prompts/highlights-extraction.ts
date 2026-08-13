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
  const lines = segments.map((s) => `[${s.start}] ${s.text}`).join('\n');
  return `Transcript segments (start time in seconds, then text):\n\n${lines}`;
}

export interface ExtractedHighlight {
  start: number;
  end: number;
  label: string;
}

/**
 * Parses the model's JSON array response, dropping any entry that doesn't
 * match a real segment start time (guards against a hallucinated timestamp
 * slipping through despite the prompt instruction) or is otherwise malformed.
 */
export function parseHighlightsExtraction(
  text: string,
  validSegmentStarts: ReadonlySet<number>
): ExtractedHighlight[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: ExtractedHighlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { start, end, label } = item as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof label !== 'string') continue;
    if (!validSegmentStarts.has(start)) continue;
    if (end <= start || label.trim().length === 0) continue;
    out.push({ start, end, label: label.trim() });
  }
  return out;
}
