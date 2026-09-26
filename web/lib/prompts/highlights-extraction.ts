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
export const MAX_PROMPT_TAKEAWAYS = 10;

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

/**
 * Windowed-extraction prompts (2026-09-25, full-coverage RCA: video
 * f6We53TnkbU / analysis 434ef182 -- the single-pass prompt over a 32-min,
 * ~15k-token transcript let the cascade model concentrate all 10
 * takeaway-mapped highlights in the first ~50% of the timeline, verified by
 * an exact-prompt repro call returning nothing past 1245s/1930s while the
 * hosted-setup guide lives at ~1500-1900s). The transcript is now harvested
 * per time window with a per-window quota, so every part of the video is
 * sampled regardless of model attention bias. parent_takeaway_idx is
 * OPTIONAL here (null when no takeaway matches) -- the reel is a
 * whole-timeline sample, not strictly takeaway-anchored; Reconciliation
 * re-maps takeaways downstream where applicable.
 */
export function buildHighlightsWindowedSystemPrompt(quota: number, maxSegmentDurationSeconds: number): string {
  return `You select the most noteworthy moments from an excerpt of a video transcript, for a highlights reel. This excerpt covers one time window of a longer video. Pick the moments a viewer would most want to jump to: key claims, demos, numbers, decisions, and narrative turns. Mundane filler, pleasantries, and navigation chatter are never noteworthy.

Output ONLY a JSON array, no prose or markdown fence (possibly empty []). Each element: {"start": <number, seconds, MUST exactly match a segment's start time from the input -- never invent or interpolate a timestamp>, "end": <number, seconds, one decimal place, the real end of the moment's topic, MUST satisfy end > start and duration <= ${maxSegmentDurationSeconds}, typically 15-60s, natural topic boundaries>, "label": <string, one short sentence describing the moment>, "parent_takeaway_idx": <integer 0-indexed [Index X] of the listed takeaway this moment best matches, or null if none matches> }.

Select at most ${quota} moments from this excerpt -- fewer if the excerpt is thin, but include every genuinely strong moment. Never fabricate a timestamp that isn't one of the given segment start times.`;
}

export function buildHighlightsWindowedUserMessage(segments: Array<{ start: number; text: string }>, quota: number, takeaways?: string[]): string {
  const promptTakeaways = (takeaways || []).slice(0, MAX_PROMPT_TAKEAWAYS /* ellipsis: array slice, not string truncation ... */);
  const takeawaysSection = promptTakeaways.length > 0
    ? `--- KEY TAKEAWAYS (for optional matching via parent_takeaway_idx -- the excerpt's own strongest moments still count even when nothing matches) ---\n${promptTakeaways.map((takeaway, i) => `[Index ${i}] ${takeaway}`).join('\n')}\n\n`
    : '';
  const lines = segments.map((segment) => `[${segment.start}] ${segment.text}`).join('\n');
  return `${takeawaysSection}--- TRANSCRIPT EXCERPT (select up to ${quota} moments) ---\n${lines}`;
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
export interface ParseHighlightsOptions {
  takeawaysCount: number;
  maxCumulativeDuration?: number;
}

export function parseHighlightsExtraction(
  text: string,
  validSegmentStarts: ReadonlySet<number>,
  maxHighlights: number,
  minSegmentDurationSeconds: number,
  maxSegmentDurationSeconds: number,
  takeawaysCountOrOptions: number | ParseHighlightsOptions = 0,
  _budgetSeconds: number = Infinity
): HighlightsExtractionResult {
  const takeawaysCount = typeof takeawaysCountOrOptions === 'number' ? takeawaysCountOrOptions : takeawaysCountOrOptions.takeawaysCount;
  const parseResult = parseJsonArray(text, 'highlights-extraction');
  if (parseResult.status === 'invalid') return { status: 'invalid' };
  const raw = parseResult.data;
  if (!Array.isArray(raw)) return { status: 'invalid' };

  const seenStarts = new Set<number>();
  // Strict 1:1 DAG enforcement (2026-08-29 master dispatch): when takeaways
  // drive extraction, at most one highlight may claim a given
  // parent_takeaway_idx. Without this, a model returning two highlights for
  // takeaway 3 and none for takeaway 7 passes every per-entry check yet
  // violates the N<->N contract (scrubber count vs takeaway count drift).
  // First occurrence in model-output order wins -- the model's primary pick.
  const seenTakeawayIdxs = new Set<number>();
  const out: ExtractedHighlight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { start, end, label } = item as Record<string, unknown>;
    const rawTakeawayIdx = (item as Record<string, unknown>).parent_takeaway_idx ?? (item as Record<string, unknown>).takeawayIdx ?? (item as Record<string, unknown>).takeaway_idx;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof label !== 'string') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // start MUST be a real segment start time (prevents hallucinated timestamps).
    const matchedStart = findNearestSegmentStart(start, validSegmentStarts, 1.0);
    if (matchedStart === null) continue;
    const finalStart = matchedStart;
    // Temporal sanity: end MUST be > start. Reject inverted timestamps
    // (e.g. 05:41–05:38 where end < start) rather than silently fixing to
    // start+30s, which would hide LLM hallucinations and cause scrubber
    // (11 raw) vs table (8 after dropping) drift. Only clamp valid durations
    // to natural 15-60s boundaries.
    if (end <= finalStart) continue;
    const duration = end - finalStart;
    let clampedEnd = duration < minSegmentDurationSeconds
      ? finalStart + minSegmentDurationSeconds
      : duration > maxSegmentDurationSeconds
        ? finalStart + maxSegmentDurationSeconds
        : end;
    if (clampedEnd <= finalStart) continue;
    if (seenStarts.has(finalStart)) continue;
    // takeawayIdx: nullable integer in [0, takeawaysCount). A non-integer
    // (string, NaN, etc.) or out-of-range value is treated as null
    // (standalone highlight, not mapped to any takeaway).
    let parsedTakeawayIdx: number | null = null;
    if (typeof rawTakeawayIdx === 'number' && Number.isFinite(rawTakeawayIdx) && Number.isInteger(rawTakeawayIdx) && rawTakeawayIdx >= 0 && rawTakeawayIdx < takeawaysCount) {
      parsedTakeawayIdx = rawTakeawayIdx;
    }
    if (takeawaysCount > 0 && parsedTakeawayIdx !== null && seenTakeawayIdxs.has(parsedTakeawayIdx)) continue;
    const rawLabel = label.trim();
    const trimmedLabel = rawLabel.length > MAX_LABEL_LENGTH ? `${rawLabel.slice(0, MAX_LABEL_LENGTH)}...` : rawLabel;
    if (trimmedLabel.length === 0) continue;
    seenStarts.add(finalStart);
    if (parsedTakeawayIdx !== null) seenTakeawayIdxs.add(parsedTakeawayIdx);
    out.push({ start: finalStart, end: clampedEnd, label: trimmedLabel, takeawayIdx: parsedTakeawayIdx, verbatimExcerpt: '' });
  }

  out.sort((left, right) => left.start - right.start);
  while (out.length > maxHighlights) out.pop(); // cap item count, not a string-display truncation
  return { status: 'ok', highlights: resolveHighlightOverlaps(out, minSegmentDurationSeconds, maxSegmentDurationSeconds) };
}

/**
 * Deterministic interval de-overlap (2026-09-25 overlap RCA: analysis
 * 434ef182 highlights idx 5 [456.1-480.0] and idx 6 [464.1-523.0] overlapped
 * -- the parser only de-duplicated identical starts, never whole intervals,
 * so a highlight could start inside the previous one and the scrubber would
 * cut one off mid-topic). Sorts by start, then walks forward: a highlight
 * starting inside the previous one is trimmed to the previous end; if the
 * trimmed remainder falls below minSegmentDuration it is dropped (clamping
 * it up would recreate the overlap); survivors are re-clamped to
 * [min, max] duration. Stable ordering (ascending start) is preserved.
 */
export function resolveHighlightOverlaps(
  highlights: ExtractedHighlight[],
  minSegmentDurationSeconds: number,
  maxSegmentDurationSeconds: number
): ExtractedHighlight[] {
  const sorted = [...highlights].sort((left, right) => left.start - right.start);
  const resolved: ExtractedHighlight[] = [];
  for (const highlight of sorted) {
    const previous = resolved[resolved.length - 1];
    const start = previous && highlight.start < previous.end ? previous.end : highlight.start;
    if (highlight.end <= start) continue; // fully contained in the previous highlight
    const end = Math.min(highlight.end, start + maxSegmentDurationSeconds);
    if (end - start < minSegmentDurationSeconds) continue;
    resolved.push({ ...highlight, start, end });
  }
  return resolved;
}
