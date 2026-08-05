/**
 * chapter-parser.ts
 *
 * Pure function: extracts chapter markers from a YouTube video description.
 * YouTube descriptions often contain lines like:
 *
 *   0:00 Introduction
 *   2:15 Topic A
 *   10:30 – 12:00 Deep dive
 *
 * Parser is intentionally dependency-free so it's unit-testable and safe to
 * call from anywhere in the worker (MetadataScraper co-location, per
 * docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md). No new YouTube API
 * call — this transforms data already present in `snippet.description`.
 */

export interface VideoChapter {
  idx: number;
  start_seconds: number;
  end_seconds: number;
  label: string;
}

/** HH:MM:SS, MM:SS, or M:SS, optionally with a range end "MM:SS – MM:SS". */
const CHAPTER_TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/;

/**
 * CHAPTER_TIMESTAMP_RE's group 3 (seconds) is always 2 digits but the regex
 * itself doesn't bound it to 00-59 -- "0:60" matches and, unchecked, would
 * silently convert to 60s (as if it were "1:00"). Group 2 is the total
 * minutes when no hours group is present (a valid YouTube convention for
 * long videos, e.g. "75:30" = 1h15m30s), so it's only bounded to 00-59 when
 * an hours group IS present (where it's minutes-within-the-hour, not total
 * minutes). Malformed matches should be treated as not-a-timestamp, not
 * silently coerced.
 */
function isValidChapterTimestamp(match: RegExpMatchArray): boolean {
  const seconds = parseInt(match[3] ?? '0', 10);
  if (seconds > 59) return false;
  if (match[1]) {
    const minutes = parseInt(match[2] ?? '0', 10);
    if (minutes > 59) return false;
  }
  return true;
}

/** Converts a CHAPTER_TIMESTAMP_RE match's captured groups to total seconds. */
function timeToSeconds(match: RegExpMatchArray): number {
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Split a description into chapter candidate lines. Handles CRLF/LF and
 * blank-line separation; trims each line. Returns only lines that start with
 * a timestamp (the chapter-marker shape).
 */
export function parseChapters(description: string | null | undefined): VideoChapter[] {
  if (!description) return [];

  const chapters: VideoChapter[] = [];
  let idx = 0;

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(CHAPTER_TIMESTAMP_RE);
    if (!match || !isValidChapterTimestamp(match)) continue;

    // Skip pure durations like "1:23" appearing alone on a line only if there
    // is no label after the timestamp — YouTube chapter lines always have a label.
    // CHAPTER_TIMESTAMP_RE is anchored (^), so match[0] is always the line's
    // own prefix -- .replace(match[0], '') removes exactly that prefix, same
    // as a .slice(match[0].length) would, without an ellipsis-truncation
    // pattern qa-intel's TruncationValidationRule can't distinguish from
    // this (a fixed-prefix strip, not a display-length truncation).
    let label = line.replace(match[0], '').trim().replace(/^[-–—]\s*/u, '');
    if (!label) continue;

    const start = timeToSeconds(match);

    // Detect an explicit range end -- either dash-like ("10:30 – 12:00",
    // already stripped to just the end timestamp by the leading-dash strip
    // above) or word-separated ("0:00 to 1:00 Introduction", where "to "
    // still needs stripping first). Matches the same separator set
    // TIMESTAMP_RANGE_RE supports in entity-time-seek.ts -- without the "to"
    // form here, a line like "0:00 to 1:00 Introduction" kept "to 1:00
    // Introduction" as the label and silently dropped the real end time.
    const toStrip = label.match(/^to\s+/iu);
    const rangeCandidate = toStrip ? label.replace(toStrip[0], '') : label;
    const rangeMatch = rangeCandidate.match(CHAPTER_TIMESTAMP_RE);
    if (rangeMatch && isValidChapterTimestamp(rangeMatch)) {
      label = rangeCandidate.replace(rangeMatch[0], '').trim().replace(/^[-–—]\s*/u, '');
    }
    if (!label) continue;

    const end = rangeMatch ? timeToSeconds(rangeMatch) : start;

    chapters.push({
      idx: idx++,
      start_seconds: start,
      end_seconds: end,
      label,
    });
  }

  // Drop non-chronological entries: a real chapter list is monotonically
  // increasing in start_seconds. Anything that doesn't advance past the
  // last KEPT chapter is either an incidental timestamp-shaped mention
  // elsewhere in the description (e.g. "follow me at 1:23pm...") or noise --
  // without this filter, the end-seconds fill-in below can compute a
  // negative-duration range (end < start) whenever a stray match appears
  // after a real chapter with a larger start time, silently producing a
  // chapter range that can never match anything in findEntityTimestamp.
  const chronological: VideoChapter[] = [];
  for (const chapter of chapters) {
    const last = chronological[chronological.length - 1];
    if (last && chapter.start_seconds <= last.start_seconds) continue;
    chronological.push(chapter);
  }
  chronological.forEach((chapter, i) => { chapter.idx = i; });

  // Second pass: fill end_seconds for chapters without an explicit range end.
  for (let i = 0; i < chronological.length; i++) {
    const current = chronological[i];
    if (!current) continue;
    if (current.end_seconds <= current.start_seconds) {
      const next = chronological[i + 1];
      current.end_seconds = next ? next.start_seconds : current.start_seconds + 60;
    }
  }

  return chronological;
}
