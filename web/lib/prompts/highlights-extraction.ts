import { parseJsonArray } from '@/lib/utils/json-parser';
/**
 * Highlights extraction -- timestamped keypoints for the auto-scrubber
 * (docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md).
 * Runs in the same pass as the executive digest, while the source transcript
 * is still within its 72h retention window (ADR 012) -- this is the only
 * place real segment timing exists.
 */

/**
 * Built dynamically (not a static string) because maxCount is a Settings
 * Registry tunable (highlights.maxCount, default 40) -- see
 * 20260820120000_highlights_reel_uncap_settings.sql. There is deliberately
 * no fixed target count or percentage-of-runtime instruction here: a live
 * user report (2026-08-20) rejected the prior "select between 4 and 12
 * moments" wording as an arbitrary compression cap that discarded
 * genuinely important content on dense videos. maxCount is a defensive
 * ceiling against runaway output, not a target to aim for.
 *
 * maxSegmentDurationSeconds (2026-08-21): the cap for each highlight's
 * content-driven duration. The LLM returns an `end` timestamp that marks
 * the real end of the topic being discussed (not the next highlight's
 * start). This value bounds that duration so the model doesn't produce
 * over-long segments.
 */
export function buildHighlightsExtractionSystemPrompt(maxCount: number, maxSegmentDurationSeconds: number): string {
  return `You extract the most noteworthy moments from a video transcript for a highlights reel. You are given transcript segments, each with a start time in seconds and its spoken text. Select the moments a viewer researching this video would most want to see -- claims, reveals, pricing/numbers mentioned, strong opinions, key demonstrations -- not filler, greetings, or transitions.

Output ONLY a JSON array, no prose before or after, no markdown code fence. Each element: {"start": <number, seconds, MUST exactly match a segment's start time from the input -- never invent or interpolate a timestamp>, "end": <number, seconds, to one decimal place, the timestamp where the discussion of this highlight's topic actually ends in the transcript. This must be the real end of the point being made -- not the start of the next highlight. Cover the minimum amount of the topic needed to include all meaningful keywords from that excerpt. Do not extend beyond the topic's natural boundary. The end value does NOT need to align with any segment boundary -- it can be any real timestamp between the highlight's start and the next highlight's start (or the video end).>, "label": <string, one short sentence describing what happens at this moment>, "takeawayIdx": <number or null, 0-indexed index of the takeaway this highlight maps to (from the KEY TAKEAWAYS list in the user message), or null if this highlight is important but not mapped to any takeaway>}.

Each highlight's duration (end - start) should vary naturally -- short points get 5-15 seconds, longer discussions get 30-90 seconds. Never exceed ${maxSegmentDurationSeconds} seconds for any single highlight. The end timestamp is the real end of the topic, not the start of the next highlight -- do not use the next highlight's start time as the end value.

Select every genuinely important moment -- there is NO fixed target count and NO fixed percentage of the video's runtime to aim for. A short, sparse video may only have a handful of real moments; a long, dense video may genuinely have several dozen. Do not artificially limit yourself to a small round number, and do not pad the list with filler to hit a count either -- only include moments a viewer would actually want to see. Hard ceiling: never return more than ${maxCount} moments even if more exist (pick the ${maxCount} most noteworthy if the video has more than that). Never fabricate a timestamp that isn't one of the given segment start times. If the transcript is too short or has no distinct noteworthy moments, return an empty array [].`;
}

export function buildHighlightsExtractionUserMessage(segments: Array<{ start: number; text: string }>, takeaways?: string[]): string {
  const takeawaysSection = takeaways && takeaways.length > 0
    ? `--- KEY TAKEAWAYS (from the executive digest) ---\n${takeaways.map((takeaway, i) => `${i + 1}. ${takeaway}`).join('\n')}\n\nFor each takeaway, identify the timestamp range in the transcript where that point is discussed. Map each highlight to the takeaway it represents by setting the takeawayIdx field (0-indexed, matching the takeaways list order above). If a takeaway has no clear transcript location, skip it. If a transcript moment is important but not in the takeaways, you may still include it with takeawayIdx: null.\n\n`
    : '';
  const lines = segments.map((segment) => `[${segment.start}] ${segment.text}`).join('\n');
  return `${takeawaysSection}--- TRANSCRIPT (with timestamps) ---\n${lines}`;
}

export interface ExtractedHighlight {
  start: number;
  end: number;
  label: string;
  takeawayIdx: number | null;
  verbatimExcerpt: string;
}

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
 * maxHighlights (Settings Registry `highlights.maxCount`, default 40) --
 * a defensive limit even though the prompt already asks for this shape,
 * since a bad model response shouldn't be trusted to self-limit.
 */
export function parseHighlightsExtraction(
  text: string,
  validSegmentStarts: ReadonlySet<number>,
  maxHighlights: number,
  minSegmentDurationSeconds: number,
  maxSegmentDurationSeconds: number,
  takeawaysCount: number = 0
): HighlightsExtractionResult {
  const parseResult = parseJsonArray(text, 'highlights-extraction');
  if (parseResult.status === 'invalid') return { status: 'invalid' };
  const raw = parseResult.data;
  if (!Array.isArray(raw)) return { status: 'invalid' };

  const seenStarts = new Set<number>();
  const out: ExtractedHighlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { start, end, label, takeawayIdx } = item as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof label !== 'string') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // start MUST be a real segment start time (prevents hallucinated timestamps).
    if (!validSegmentStarts.has(start)) continue;
    // end is NO longer required to be a real segment start time (2026-08-21):
    // the LLM now returns a content-driven end timestamp, not the next
    // highlight's start. Only end > start and a duration clamp are enforced.
    if (end <= start) continue;
    // Duration clamp: old data with "end = next segment start" could produce
    // very long spans, and a model can return a sub-floor point. Clamp the
    // duration into [min, max] instead of discarding the highlight.
    const duration = end - start;
    const clampedEnd = duration < minSegmentDurationSeconds
      ? start + minSegmentDurationSeconds
      : duration > maxSegmentDurationSeconds
        ? start + maxSegmentDurationSeconds
        : end;
    if (seenStarts.has(start)) continue;
    // takeawayIdx: nullable integer in [0, takeawaysCount). A non-integer
    // (string, NaN, etc.) or out-of-range value is treated as null
    // (standalone highlight, not mapped to any takeaway).
    let parsedTakeawayIdx: number | null = null;
    if (typeof takeawayIdx === 'number' && Number.isFinite(takeawayIdx) && Number.isInteger(takeawayIdx) && takeawayIdx >= 0 && takeawayIdx < takeawaysCount) {
      parsedTakeawayIdx = takeawayIdx;
    }
    const rawLabel = label.trim();
    const trimmedLabel = rawLabel.length > MAX_LABEL_LENGTH ? `${rawLabel.slice(0, MAX_LABEL_LENGTH)}...` : rawLabel;
    if (trimmedLabel.length === 0) continue;
    seenStarts.add(start);
    out.push({ start, end: clampedEnd, label: trimmedLabel, takeawayIdx: parsedTakeawayIdx, verbatimExcerpt: '' });
  }

  out.sort((left, right) => left.start - right.start);
  while (out.length > maxHighlights) out.pop(); // cap item count, not a string-display truncation
  return { status: 'ok', highlights: out };
}
