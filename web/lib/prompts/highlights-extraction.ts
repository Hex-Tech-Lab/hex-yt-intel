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
function findNearestSegmentStart(targetTime: number, availableStarts: Iterable<number>, maxEpsilon = 1.0): number | null {
  let closest: number | null = null;
  let minDiff = Infinity;
  for (const segStart of availableStarts) {
    const diff = Math.abs(segStart - targetTime);
    if (diff <= maxEpsilon && diff < minDiff) {
      minDiff = diff;
      closest = segStart;
    }
  }
  return closest;
}

export function buildHighlightsExtractionSystemPrompt(maxCount: number, maxSegmentDurationSeconds: number = 90): string {
  return `You extract noteworthy key moments from a video transcript for a highlights reel. Given transcript segments with start times (seconds) and spoken text, select key claims, reveals, pricing/numbers, and demonstrations (no filler or transitions).

Output ONLY a raw JSON array of objects without prose or code fences:
[{"start": <number, must match segment start>, "end": <number, seconds to 1 decimal, topic end, duration <= ${maxSegmentDurationSeconds}s>, "label": <string, one short sentence>, "takeawayIdx": <number | null, 0-indexed takeaway mapping or null>}]

Rules:
1. Duration (end - start) must be 5-${maxSegmentDurationSeconds}s. "end" is the real topic end, not next highlight start.
2. Select genuine key moments up to a strict ceiling of ${maxCount} items.
3. Every "start" MUST match an input segment start. Never fabricate timestamps.
4. If the transcript lacks distinct noteworthy moments, return [].`;
}

export function buildHighlightsExtractionUserMessage(segments: Array<{ start: number; text: string }>, takeaways?: string[]): string {
  const cappedTakeaways = (takeaways || []).filter((_takeaway, i) => i < 10);
  const takeawaysSection = cappedTakeaways.length > 0
    ? `--- KEY TAKEAWAYS (from the executive digest) ---\n${cappedTakeaways.map((takeaway, i) => `${i + 1}. ${takeaway}`).join('\n')}\n\nFor each takeaway, map corresponding highlights via 0-indexed takeawayIdx (or null if not in takeaways).\n\n`
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
    const matchedStart = findNearestSegmentStart(start, validSegmentStarts, 1.0);
    if (matchedStart === null) continue;
    const finalStart = matchedStart;
    // end is NO longer required to be a real segment start time (2026-08-21):
    // the LLM now returns a content-driven end timestamp, not the next
    // highlight's start. Only end > start and a duration clamp are enforced.
    if (end <= finalStart) continue;
    // Duration clamp: old data with "end = next segment start" could produce
    // very long spans, and a model can return a sub-floor point. Clamp the
    // duration into [min, max] instead of discarding the highlight.
    const duration = end - finalStart;
    const clampedEnd = duration < minSegmentDurationSeconds
      ? finalStart + minSegmentDurationSeconds
      : duration > maxSegmentDurationSeconds
        ? finalStart + maxSegmentDurationSeconds
        : end;
    if (seenStarts.has(finalStart)) continue;
    // takeawayIdx: nullable integer in [0, takeawaysCount). A non-integer
    // (string, NaN, etc.) or out-of-range value is treated as null
    // (standalone highlight, not mapped to any takeaway).
    let parsedTakeawayIdx: number | null = null;
    if (typeof takeawayIdx === 'number' && Number.isFinite(takeawayIdx) && Number.isInteger(takeawayIdx) && takeawayIdx >= 0 && takeawayIdx < takeawaysCount) {
      parsedTakeawayIdx = takeawayIdx;
    }
    const rawLabel = label.trim();
    const trimmedLabel = rawLabel.length > MAX_LABEL_LENGTH ? rawLabel.slice(0, MAX_LABEL_LENGTH) + '...' : rawLabel;
    if (trimmedLabel.length === 0) continue;
    seenStarts.add(finalStart);
    out.push({ start: finalStart, end: clampedEnd, label: trimmedLabel, takeawayIdx: parsedTakeawayIdx, verbatimExcerpt: '' });
  }

  out.sort((left, right) => left.start - right.start);
  while (out.length > maxHighlights) out.pop(); // cap item count, not a string-display truncation
  return { status: 'ok', highlights: out };
}
