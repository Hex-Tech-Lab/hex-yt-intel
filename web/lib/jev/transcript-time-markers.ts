/**
 * R3b Phase 2.6 time-sync (isomorphic: web + worker). The prompt transcript
 * used to be plain text, so every `[HH:MM:SS]` the model wrote was a guess
 * from position — and a K>1 cell guessed from zero for its own slice. This
 * inserts REAL video times from the timed segments into the text the model
 * reads, plus a one-line header naming the range it covers.
 *
 * Pure. Never touches the signed slice: callers annotate AFTER the slice hash
 * check. Returns null (caller keeps plain text) when segments are missing or
 * their words do not line up with the text.
 */

import { tokenizeTranscript } from './transcript-slice';

export interface TimedSegment {
  start: number;
  duration?: number;
  text: string;
}

export interface TimeAnnotated {
  text: string;
  startSeconds: number;
  endSeconds: number;
  /** True when maxChars cut the excerpt (only the visible words are annotated). */
  truncated: boolean;
}

/** Fallback only; the live value is the registry key analysis.jev.timeMarkerIntervalSeconds. */
export const TIME_MARKER_INTERVAL_SECONDS = 30;
export const TIME_MARKER_INTERVAL_MIN_SECONDS = 5;
export const TIME_MARKER_INTERVAL_MAX_SECONDS = 300;

/** 3725.4 -> "01:02:05". */
export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * Start (and segment end) time of every word of the full transcript, in
 * order. A segment with a non-finite start keeps its words (so word indexes
 * still line up with the text) and inherits the previous time.
 */
function wordTimes(segments: readonly TimedSegment[]): { words: string[]; starts: number[]; ends: number[] } {
  const words: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lastStart = 0;
  for (const segment of segments) {
    const start = typeof segment.start === 'number' && Number.isFinite(segment.start) ? segment.start : lastStart;
    lastStart = start;
    const end = typeof segment.duration === 'number' && Number.isFinite(segment.duration) && segment.duration > 0 ? start + segment.duration : start;
    for (const word of tokenizeTranscript(segment.text ?? '')) {
      words.push(word);
      starts.push(start);
      ends.push(end);
    }
  }
  return { words, starts, ends };
}

/**
 * Annotate `text` — the words [startWord, startWord + n) of the full
 * transcript — with a `[HH:MM:SS]` marker before the first word at or after
 * every `intervalSeconds` boundary, and a header line. Null when segments are
 * absent or the text's words do not match the segments' words at that offset
 * (different provider/normalization): plain text is safer than wrong times.
 */
export function annotateWithTimeMarkers(
  text: string,
  segments: readonly TimedSegment[] | undefined,
  options: { startWord: number; durationSeconds?: number; intervalSeconds?: number; maxChars?: number },
): TimeAnnotated | null {
  if (!segments || segments.length === 0) return null;
  const sliceWords = tokenizeTranscript(text);
  if (sliceWords.length === 0) return null;
  const { words, starts, ends } = wordTimes(segments);
  const { startWord } = options;
  if (!Number.isInteger(startWord) || startWord < 0 || startWord + sliceWords.length > words.length) return null;
  for (let index = 0; index < sliceWords.length; index += 1) {
    if (words[startWord + index] !== sliceWords[index]) return null;
  }

  // The prompt budget is spent on the PLAIN words, never on markers: cut at a
  // word boundary first, then annotate only what the model will see.
  let visible = sliceWords.length;
  if (options.maxChars !== undefined && options.maxChars > 0) {
    let length = -1;
    for (let index = 0; index < sliceWords.length; index += 1) {
      length += (sliceWords[index] as string).length + 1;
      if (length > options.maxChars) {
        visible = Math.max(1, index);
        break;
      }
    }
  }
  const truncated = visible < sliceWords.length;

  // Clamped here too: the value arrives unsigned in the stream request, and a
  // tiny interval would put a marker before almost every word (prompt 2-3x).
  const requested = options.intervalSeconds;
  const interval = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.min(TIME_MARKER_INTERVAL_MAX_SECONDS, Math.max(TIME_MARKER_INTERVAL_MIN_SECONDS, requested))
    : TIME_MARKER_INTERVAL_SECONDS;
  const out: string[] = [];
  let nextBoundary = -Infinity;
  for (let index = 0; index < visible; index += 1) {
    const time = starts[startWord + index] as number;
    if (time >= nextBoundary) {
      out.push(`[${formatClock(time)}]`);
      nextBoundary = (Math.floor(time / interval) + 1) * interval;
    }
    out.push(sliceWords[index] as string);
  }

  const startSeconds = starts[startWord] as number;
  const endSeconds = ends[startWord + visible - 1] as number;
  const duration = options.durationSeconds;
  const total = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? ` of a ${formatClock(duration)} video` : '';
  const header =
    `[TIMELINE] This transcript excerpt covers ${formatClock(startSeconds)}–${formatClock(endSeconds)}${total}. ` +
    'Bracketed [HH:MM:SS] markers are the real video times of the words that follow them. ' +
    'Every timestamp you cite MUST come from these markers (use the nearest marker at or before the point); ' +
    'never estimate a time from position in the text and never cite a time outside this range.';
  const notice = truncated
    ? `\n\n[...excerpt truncated to fit the prompt budget: the model sees ${formatClock(startSeconds)}–${formatClock(endSeconds)} only; anything later in this excerpt is not analyzed]`
    : '';
  return { text: `${header}\n\n${out.join(' ')}${notice}`, startSeconds, endSeconds, truncated };
}
