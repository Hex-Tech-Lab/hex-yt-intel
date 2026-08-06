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

/** Per-mention match — used by findAllEntityMentions and findNearestEntityMention. */
export interface EntityMentionMatch {
  timestamp: string;
  seekSeconds: number;
  occurrenceIndex: number;
}

/**
 * Find the nearest preceding timestamp (or range start) before a given
 * position in text. Shared helper used by both findEntityTimestamp (single
 * occurrence) and findAllEntityMentions (all occurrences).
 */
function findPrecedingTimestamp(text: string): string | null {
  const rangeMatches = [...text.matchAll(TIMESTAMP_RANGE_RE)];
  const lastRange = rangeMatches[rangeMatches.length - 1];
  if (lastRange) {
    const afterRange = text.slice(lastRange.index! + lastRange[0].length);
    if (afterRange.trim() === '') {
      const startTime = lastRange[0].match(TIMESTAMP_RE);
      if (startTime) return startTime[0];
    }
  }
  const timestamps = [...text.matchAll(TIMESTAMP_RE_GLOBAL)];
  if (timestamps.length > 0) {
    return timestamps[timestamps.length - 1]![0];
  }
  return null;
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

/**
 * Find all entity mentions in dimension content — returns every occurrence
 * of the entity's label in the dimension prose, each resolved to its own
 * timestamp via the same nearest-preceding-timestamp logic (including
 * range-format handling and chapter-boundary snapping).
 *
 * For node.label/node.content/node.keyTerms direct-field timestamp matches
 * (which are single authoritative values, not prose with multiple
 * occurrences), returns a single-element array. Returns empty array when
 * no timestamp can be resolved at all.
 */
export function findAllEntityMentions(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): EntityMentionMatch[] {
  // Direct field matches (single authoritative value, not prose)
  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) {
    const ts = applyChapterBoundary(labelMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) {
    const ts = applyChapterBoundary(contentMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) {
    const ts = applyChapterBoundary(keyTermsMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  if (!dimensionContent) return [];

  const label = node.label;
  if (label) {
    const mentions: EntityMentionMatch[] = [];
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRe = new RegExp(escapedLabel, 'g');

    // occurrenceIndex must reflect the label's position in the SOURCE TEXT
    // (every textual occurrence), not the position in the resolved-mentions
    // array -- an earlier occurrence with no resolvable preceding timestamp
    // is skipped (not pushed), so counting off `mentions.length` would
    // mislabel the next resolved occurrence as index 0 instead of its real
    // index (post-review finding, 2026-08-06).
    const labelMatches = dimensionContent.matchAll(labelRe);
    let textOccurrenceIndex = 0;
    for (const labelMatchResult of labelMatches) {
      const beforeLabel = dimensionContent.slice(0, labelMatchResult.index);
      const candidateStr = findPrecedingTimestamp(beforeLabel);
      if (candidateStr) {
        const ts = applyChapterBoundary(candidateStr, chapters);
        mentions.push({ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: textOccurrenceIndex });
      }
      textOccurrenceIndex++;
    }

    if (mentions.length > 0) return mentions;
  }

  // No label match found — fall back to first timestamp in dimension content
  const singleMatch = dimensionContent.match(TIMESTAMP_RE);
  if (singleMatch) {
    const ts = applyChapterBoundary(singleMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const rangeMatch = dimensionContent.match(TIMESTAMP_RANGE_RE);
  const rangeText = rangeMatch?.[0];
  if (rangeText) {
    const startTime = rangeText.match(TIMESTAMP_RE);
    if (startTime) {
      const ts = applyChapterBoundary(startTime[0], chapters);
      return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
    }
  }

  return [];
}

/**
 * Pick the entity mention nearest the video's current playback position.
 * Falls back to the first mention when currentPlaybackSeconds is null
 * (nothing has played yet) or when there are no mentions.
 */
export function findNearestEntityMention(
  node: EntityTimeSeekNode,
  dimensionContent: string | null | undefined,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  currentPlaybackSeconds: number | null,
): EntityMentionMatch | null {
  const mentions = findAllEntityMentions(node, dimensionContent, chapters);
  if (mentions.length === 0) return null;
  if (currentPlaybackSeconds === null || currentPlaybackSeconds === undefined) return mentions[0]!;
  return mentions.reduce((best, mention) => {
    const dist = Math.abs(mention.seekSeconds - currentPlaybackSeconds);
    const bestDist = Math.abs(best.seekSeconds - currentPlaybackSeconds);
    return dist < bestDist ? mention : best;
  });
}

export function findEntityTimestamp(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): string | null {
  const mentions = findAllEntityMentions(node, dimensionContent, chapters);
  return mentions[0]?.timestamp ?? null;
}
