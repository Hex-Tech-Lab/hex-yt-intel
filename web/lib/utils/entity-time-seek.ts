/**
 * entity-time-seek.ts
 *
 * Pure helper for the entity-click "seek video to timestamp" feature
 * (DashboardContainer's `handleSelectNode`). Extracted so the match-ranking
 * logic is unit-testable without mounting the container component.
 *
 * KG nodes don't carry a native timestamp field — they're semantic entities
 * (people, concepts, tools) extracted by the LLM, not time-indexed events.
 * Timestamps DO exist in the dimension content (LLM prose includes inline
 * markers like [12:34] that TimestampLink already renders). This function
 * falls back to searching the dimension content for the entity's label when
 * the node's own fields don't contain a timestamp.
 *
 * Supports both single timestamps (MM:SS, HH:MM:SS) and range formats
 * ("60:00–65:00", "60:00-65:00", "60:00 to 65:00") — extracts the start
 * time from any range.
 */

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;
const TIMESTAMP_RE_GLOBAL = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
// Range separator: en-dash, hyphen, or "to" (case-insensitive, word-bounded).
// Must be an alternation (?:–|-|to), not a [...] character class -- a class
// treats "to" as the two individual characters 't'/'o', not the literal
// word, silently breaking the "60:00 to 65:00" case despite looking correct.
const TIMESTAMP_RANGE_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\s*(?:–|-|to)\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\b/gi;

/** Parse "HH:MM:SS", "MM:SS", or "M:SS" to seconds. NaN on no match. */
function timeToSeconds(ts: string): number {
  const match = ts.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Format seconds back to the "MM:SS" / "HH:MM:SS" display form. */
function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export interface EntityTimeSeekNode {
  label?: string | null;
  content?: string | null;
  keyTerms?: string[] | null;
}

/** Chapter boundary, matching the transcript_chapters table shape. */
export interface EntityTimeSeekChapter {
  start_seconds: number;
  end_seconds: number;
  label?: string | null;
}

/**
 * Find the timestamp string most relevant to a given entity node.
 *
 * Searches in priority order:
 * 1. Node's own `label` field (most specific signal)
 * 2. Node's own `content` field
 * 3. Node's own `keyTerms` array
 * 4. Dimension content (fallback — KG nodes are semantic entities, not
 *    time-indexed events, but the dimension's prose contains inline
 *    timestamps that correlate to when the entity was discussed)
 *
 * The dimension-content fallback uses the entity's label as a proximity
 * anchor: it finds the label in the dimension text, then returns the
 * nearest timestamp before it. If no label match is found, returns the
 * first timestamp in the dimension content.
 *
 * When chapters are provided, the entity-relevant timestamp (from any of
 * the above steps) is then checked against chapter boundaries. If it falls
 * inside a chapter's [start_seconds, end_seconds] range, the chapter's
 * start is returned instead of the raw timestamp — real chapter boundaries
 * are more reliable anchors than regex guesses. When no chapter data exists
 * (most already-analyzed videos), this behaves exactly as before.
 */
/**
 * If `chapters` covers the candidate timestamp, snap it to that chapter's
 * start (a real chapter boundary is a more reliable anchor than a raw
 * regex-extracted timestamp). On a tie at a shared boundary (candidate ===
 * some chapter's end === the next chapter's start), prefer the chapter with
 * the greater start_seconds -- the newly-started chapter, not the ending
 * one, since chapter ranges are filled contiguous ([start, next.start]) by
 * the parser and an exact-boundary timestamp reads as "the next chapter
 * just began," not "the previous one is still ending."
 */
function applyChapterBoundary(candidateStr: string, chapters?: EntityTimeSeekChapter[] | null): string {
  if (!chapters || chapters.length === 0) return candidateStr;
  const candidateSeconds = timeToSeconds(candidateStr);
  if (Number.isNaN(candidateSeconds)) return candidateStr;
  const chapter = chapters.reduce<EntityTimeSeekChapter | null>((best, ch) => {
    const inRange = candidateSeconds >= ch.start_seconds && candidateSeconds <= ch.end_seconds;
    if (!inRange) return best;
    if (!best || ch.start_seconds > best.start_seconds) return ch;
    return best;
  }, null);
  return chapter ? formatTimestamp(chapter.start_seconds) : candidateStr;
}

export function findEntityTimestamp(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): string | null {
  // Entity-relevant candidate found FIRST (label/content/keyTerms, then
  // dimension-content proximity), chapter-boundary snapping applied to
  // WHATEVER candidate is found -- uniformly, not just the dimension-content
  // fallback. Applying it only to the fallback path (the original P0-4 fix,
  // 2026-08-05) left node.label/content/keyTerms matches unsnapped whenever
  // an entity's own field happened to carry a literal timestamp.
  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) return applyChapterBoundary(labelMatch[0], chapters);

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) return applyChapterBoundary(contentMatch[0], chapters);

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) return applyChapterBoundary(keyTermsMatch[0], chapters);

  if (dimensionContent) {
    let candidateStr: string | null = null;

    const label = node.label;
    if (label) {
      const labelIdx = dimensionContent.indexOf(label);
      if (labelIdx >= 0) {
        const beforeLabel = dimensionContent.slice(0, labelIdx);
        const timestamps = [...beforeLabel.matchAll(TIMESTAMP_RE_GLOBAL)];
        if (timestamps.length > 0) {
          candidateStr = timestamps[timestamps.length - 1]![0];
        }
      }
    }

    if (!candidateStr) {
      const singleMatch = dimensionContent.match(TIMESTAMP_RE);
      if (singleMatch) candidateStr = singleMatch[0];
    }

    if (!candidateStr) {
      const rangeMatch = dimensionContent.match(TIMESTAMP_RANGE_RE);
      if (rangeMatch) {
        const startTime = rangeMatch[0]!.match(TIMESTAMP_RE);
        if (startTime) candidateStr = startTime[0];
      }
    }

    if (candidateStr) return applyChapterBoundary(candidateStr, chapters);
  }

  return null;
}
