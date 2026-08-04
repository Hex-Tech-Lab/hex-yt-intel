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
  const m = ts.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  return hours * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10);
}

/** Format seconds back to the "MM:SS" / "HH:MM:SS" display form. */
function formatTimestamp(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
 * 0. Chapter data (if provided) — if the dimension content's timestamp falls
 *    inside a chapter's [start_seconds, end_seconds] range, use the chapter
 *    start as the anchor. Real chapter boundaries are more reliable than a
 *    regex guess (docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md).
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
 * first timestamp in the dimension content. When no chapter data exists
 * (most already-analyzed videos), this behaves exactly as before.
 */
export function findEntityTimestamp(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): string | null {
  // First-choice path: real chapter boundaries. Extract a candidate time
  // from the dimension content, then see if it falls inside a chapter range.
  if (dimensionContent && chapters && chapters.length > 0) {
    const candidate = dimensionContent.match(TIMESTAMP_RE) || dimensionContent.match(TIMESTAMP_RANGE_RE);
    if (candidate) {
      const startTimeMatch = candidate[0].match(TIMESTAMP_RE);
      if (startTimeMatch) {
        const t = timeToSeconds(startTimeMatch[0]);
        const chapter = chapters.find((c) => t >= c.start_seconds && t <= c.end_seconds);
        if (chapter) return formatTimestamp(chapter.start_seconds);
      }
    }
  }

  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) return labelMatch[0];

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) return contentMatch[0];

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) return keyTermsMatch[0];

  if (dimensionContent) {
    const label = node.label;
    if (label) {
      const labelIdx = dimensionContent.indexOf(label);
      if (labelIdx >= 0) {
        const beforeLabel = dimensionContent.slice(0, labelIdx);
        const timestamps = [...beforeLabel.matchAll(TIMESTAMP_RE_GLOBAL)];
        if (timestamps.length > 0) {
          return timestamps[timestamps.length - 1]![0];
        }
      }
    }
    const singleMatch = dimensionContent.match(TIMESTAMP_RE);
    if (singleMatch) return singleMatch[0];
    // Fallback: try to extract start time from a range format like "60:00–65:00"
    const rangeMatch = dimensionContent.match(TIMESTAMP_RANGE_RE);
    if (rangeMatch) {
      const startTime = rangeMatch[0]!.match(TIMESTAMP_RE);
      if (startTime) return startTime[0];
    }
  }

  return null;
}
