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
const TIME_TO_SECONDS_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

function timeToSeconds(match: RegExpMatchArray): number {
  const hours = match[1] ? parseInt(match[1]!, 10) : 0;
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);
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
    if (!match) continue;

    // Skip pure durations like "1:23" appearing alone on a line only if there
    // is no label after the timestamp — YouTube chapter lines always have a label.
    let label = line.slice(match[0].length).trim().replace(/^[-–—]\s*/, '');
    if (!label) continue;

        const start = timeToSeconds(match);

    // Detect an explicit range end "10:30 – 12:00" and use it as end_seconds.
    // Strip the range end time from the label afterward.
    const rangeMatch = label.match(CHAPTER_TIMESTAMP_RE);
    if (rangeMatch) {
      label = label.slice(rangeMatch[0].length).trim().replace(/^[-–—]\s*/, '');
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

  // Second pass: fill end_seconds for chapters without an explicit range end.
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.end_seconds <= chapters[i]!.start_seconds) {
      const next = chapters[i + 1];
      chapters[i]!.end_seconds = next ? next.start_seconds : chapters[i]!.start_seconds + 60;
    }
  }

  return chapters;
}
