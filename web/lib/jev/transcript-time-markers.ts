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
  /** Provider invented this start time (no caption timing): never present it as real. */
  estimated?: boolean;
}

export interface TimeAnnotated {
  text: string;
  startSeconds: number;
  endSeconds: number;
  /** True when maxChars cut the excerpt (only the visible words are annotated). */
  truncated: boolean;
  /**
   * The whitespace-normalized (single-space-joined) plain-word length the
   * budget cut was computed on. Callers report truncation against THIS
   * number when annotating ran — recomputing it by re-tokenizing the text
   * duplicated the annotator's own measurement (and could drift).
   */
  normalizedLength: number;
}

/**
 * Fallback only; the live value is the registry key
 * `analysis.jev.timeMarkerIntervalSeconds` — bounds and fallback live in
 * `web/lib/config/jev.ts` (`JEV_BOUNDS.timeMarkerIntervalSeconds`,
 * `JEV_TIME_MARKER_INTERVAL_FALLBACK`) so there is exactly one source.
 */
export { JEV_TIME_MARKER_INTERVAL_FALLBACK as TIME_MARKER_INTERVAL_SECONDS, JEV_BOUNDS } from '../config/jev';
import { JEV_BOUNDS, JEV_TIME_MARKER_INTERVAL_FALLBACK } from '../config/jev';
const TIME_MARKER_INTERVAL_MIN_SECONDS = JEV_BOUNDS.timeMarkerIntervalSeconds.min;
const TIME_MARKER_INTERVAL_MAX_SECONDS = JEV_BOUNDS.timeMarkerIntervalSeconds.max;

/** True when any segment's start was invented by the provider (no caption timing). */
export function hasEstimatedTimes(segments: readonly TimedSegment[] | undefined): boolean {
  return (segments ?? []).some((segment) => segment.estimated === true);
}

/** Failure reasons for a null annotation, mirroring the guard order in `annotateWithTimeMarkers`. */
export type TimeMarkerFailureReason = 'invalid_timing' | 'estimated' | 'misaligned';

/**
 * Which guard would reject a null annotation. Guards run in the same order
 * as in `annotateWithTimeMarkers` so the reported reason matches what the
 * annotator would actually have failed on. Empty segments => 'estimated'
 * (nothing to annotate; the worker logs the softer info line, not a
 * misalignment warning).
 */
export function timeAnnotatedReasons(
  segments: readonly TimedSegment[] | undefined,
): TimeMarkerFailureReason {
  if (!segments || segments.length === 0 || hasEstimatedTimes(segments)) return 'estimated';
  let previous = -1;
  for (const segment of segments) {
    const start = segment.start;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return 'invalid_timing';
    if (previous >= 0 && start < previous) return 'invalid_timing';
    previous = start;
  }
  return 'misaligned';
}

/** 3725.4 -> "01:02:05". Intentionally ALWAYS padded HH:MM:SS for the prompt, unlike `formatTimestamp` in web/lib/utils/entity-time-seek.ts (which renders variable-precision clock times for UI seek links). */
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
  // (1) Absent segments: nothing to annotate.
  if (!segments || segments.length === 0) return null;
  // (2) Fabricated-time guard FIRST (#417 P2): a provider-invented
  // `estimated` start, a non-finite or negative start, or a start that
  // DECREASES relative to the previous segment means the segment timing is
  // not trustworthy chronological data. Deliberately checked BEFORE
  // `wordTimes` and the word-compare loop — an invalid-timing list must fail
  // with that reason (see `timeAnnotatedReasons`), and wordTimes would
  // otherwise substitute the previous timestamp (or 0) and emit it as a real
  // marker. Plain text is safer than invented time.
  if (hasEstimatedTimes(segments)) return null;
  let previous = -1;
  for (const segment of segments) {
    const start = segment.start;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return null;
    if (previous >= 0 && start < previous) return null;
    previous = start;
  }
  // (3) Word alignment: the text's words must match the segments' words at
  // this offset (different provider/normalization => plain text is safer).
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
  // Oversized single tokens (#417 P2) are CLAMPED ONCE, up front, so the
  // measuring list and the emitting list are the same — no token is counted
  // short and then emitted long.
  const maxChars = options.maxChars ?? 0;
  // substring (not slice) + no ellipsis ON PURPOSE: this is a prompt-budget
  // cut of model-readable transcript text (ellipsis omitted by design, not a
  // display truncation -- an ellipsis suffix would corrupt the text).
  const effectiveWords = maxChars > 0 ? sliceWords.map((token) => token.substring(0, maxChars) /* prompt-budget cut, ellipsis omitted by design: ... is NOT appended */) : sliceWords;
  let visible = effectiveWords.length;
  if (maxChars > 0) {
    let length = -1;
    for (let index = 0; index < effectiveWords.length; index += 1) {
      length += (effectiveWords[index] as string).length + 1;
      if (length > maxChars) {
        visible = Math.max(1, index);
        break;
      }
    }
  }
  const truncated = visible < effectiveWords.length;
  const normalizedLength = effectiveWords.join(' ').length;

  // Clamped here too: the value arrives unsigned in the stream request, and a
  // tiny interval would put a marker before almost every word (prompt 2-3x).
  const requested = options.intervalSeconds;
  const interval = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.min(TIME_MARKER_INTERVAL_MAX_SECONDS, Math.max(TIME_MARKER_INTERVAL_MIN_SECONDS, requested))
    : JEV_TIME_MARKER_INTERVAL_FALLBACK;
  const out: string[] = [];
  let nextBoundary = -Infinity;
  for (let index = 0; index < visible; index += 1) {
    const time = starts[startWord + index] as number;
    if (time >= nextBoundary) {
      out.push(`[${formatClock(time)}]`);
      nextBoundary = (Math.floor(time / interval) + 1) * interval;
    }
    out.push(effectiveWords[index] as string);
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
  return { text: `${header}\n\n${out.join(' ')}${notice}`, startSeconds, endSeconds, truncated, normalizedLength };
}
