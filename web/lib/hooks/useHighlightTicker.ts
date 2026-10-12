'use client';

// Bounds on a per-segment derived pace: real speech sits well inside these
// (stored excerpts p10 2.6 / p90 4.4 words/s); outside them the excerpt or
// the timing is suspect, so the pace is clamped rather than trusted.
const MIN_WORDS_PER_SECOND = 1.5;
const MAX_WORDS_PER_SECOND = 6;

/** Words per second for the reveal: the speaker's own pace from a verbatim
 *  excerpt over its speaking span (clamped), else the registry fallback. */
function revealPace(usingVerbatim: boolean, totalWords: number, speakingSeconds: number, fallback: number): number {
  if (!usingVerbatim || speakingSeconds <= 0) return fallback;
  return Math.min(MAX_WORDS_PER_SECOND, Math.max(MIN_WORDS_PER_SECOND, totalWords / speakingSeconds));
}

/**
 * Drives the highlights-reel "ticker" text reveal (2026-08-20 redesign --
 * no existing precedent for this piece, per the dispatch prompt). While a
 * segment plays, progressively reveals its `label` word-by-word over the
 * segment's playback duration so the on-screen text roughly tracks what's
 * being said, rather than dumping the whole label at once.
 *
 * The `label` field (one short sentence per highlight) is the only text
 * available on the analysis_highlights row -- there is no separate
 * per-segment "script" field distinct from the label the reel already uses
 * for its counter text. Documented here rather than silently assumed.
 *
 * The optional `verbatimExcerpt` param (2026-08-21, §2.C.3) overrides
 * `label` when provided and non-empty -- new analyses store a verbatim
 * transcript excerpt (extracted from the raw transcript segments at
 * generation time, zero additional LLM cost), and the ticker now reveals
 * actual transcript words instead of the LLM-synthesized paraphrase.
 * Falls back to `label` gracefully for old rows where the column is null.
 *
 * `usingVerbatim` (2026-09-07, UI-truthfulness fix): tells the caller which
 * source the reveal text actually comes from -- true iff the verbatim
 * excerpt is displayed, false when the LLM-synthesized `label` paraphrase
 * is being shown instead (legacy rows pre-2026-08-25, or a highlight whose
 * window matched no transcript segments). Consumers MUST surface this (a
 * small "summarized" badge) rather than silently passing a paraphrase off
 * as verbatim transcript text.
 *
 * `playingIdx` is the caller's source of truth for which segment is
 * currently active; `elapsedSeconds` (new 2026-08-20, shared-hook
 * extraction) is the caller's source of truth for how far into that
 * segment playback actually is. This hook now derives revealedWordCount
 * from that externally-supplied value on every render instead of owning
 * its own `setInterval` + `Date.now()` timer -- it was previously the
 * THIRD independent timer deriving "how far into this segment are we"
 * alongside each scrubber's own 250ms advance-poller (finding #2,
 * docs/agent-prompts/2026-08-20-cc-simplify-shared-playback-hook.md). No
 * timer of its own means no timer to leak/desync from the real playback
 * clock -- `elapsedSeconds` already comes from `useSegmentPlayback`'s
 * media-time poll, which is itself clamped to the real player/store time.
 *
 * 2026-09-30 (bug-2, live report "caption too fast / out of sync"): the
 * reveal mapping changed from elapsed/duration-ratio to an explicit
 * reading pace (`wordsPerSecond`, Settings Registry
 * `highlights.tickerWordsPerSecond`, default 2.5 words/s). Because
 * `elapsedSeconds` comes from the media-time poll, the reveal is
 * automatically in lockstep with the actual speech: it pauses when
 * playback pauses (the store-backed path stops updating elapsed) and
 * there is no looping -- a longer-than-readable excerpt simply doesn't
 * finish within the segment. `durationSeconds` is now only a floor for
 * the legacy ratio path's test compatibility and is no longer used by
 * the pace mapping.
 */
export function useHighlightTicker(
  playingIdx: number | null,
  label: string | null,
  // The highlight's own speaking length (end - start): unclamped and without
  // the lead-in, so words / speakingSeconds is the speaker's pace (T10).
  speakingSeconds: number,
  elapsedSeconds: number | null,
  verbatimExcerpt?: string | null,
  wordsPerSecond = 2.5,
  // Seconds of context played before the highlight's own start (2026-10-02,
  // live report "ticker gets ahead when entering a segment"): elapsedSeconds
  // counts from the lead-in, but the highlight's words only begin after it,
  // so the reveal clock starts at leadInSeconds, not 0.
  leadInSeconds = 0,
  // Real segment timings for the highlight (T6, speech-timed karaoke). When
  // present and non-empty, each word is revealed at its own start time, held
  // through silences. When absent, the pace fallback below is used unchanged.
  timedSegments?: ReadonlyArray<TimedSegment> | null,
): { revealedText: string; totalWords: number; usingVerbatim: boolean } {
  if (timedSegments && timedSegments.length > 0 && playingIdx !== null && elapsedSeconds !== null) {
    const timed = timedWordStarts(timedSegments, speakingSeconds);
    if (timed.words.length > 0) {
      // Media-time clock: elapsed counts from the lead-in, the words count from
      // the highlight's start, so subtract the lead-in the same way as below.
      const speechSeconds = elapsedSeconds - leadInSeconds;
      // At least the first word, as the pace path does, so an empty reveal never
      // makes a consumer fall back to showing the full label.
      let revealed = 1;
      while (revealed < timed.starts.length && (timed.starts[revealed] ?? Infinity) <= speechSeconds) revealed += 1;
      const shown = timed.words.slice(0, revealed).join(' ');
      return {
        revealedText: shown + (revealed < timed.words.length ? '...' : ''),
        totalWords: timed.words.length,
        usingVerbatim: true,
      };
    }
  }
  // Trim before checking truthiness: a whitespace-only verbatimExcerpt (a
  // real DB row shape a corrupt/poorly-normalized transcript can produce)
  // is truthy under a bare `Boolean()` check but yields zero real words,
  // silently falling back to `label` while still claiming `usingVerbatim`
  // (external review finding). Normalizing once here means every consumer
  // of this hook's return value sees a consistent, already-correct answer.
  const normalizedVerbatim = verbatimExcerpt?.trim() || null;
  const usingVerbatim = normalizedVerbatim !== null;
  const text = normalizedVerbatim || label;
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const totalWords = words.length;

  if (playingIdx === null || totalWords === 0 || elapsedSeconds === null) {
    // `revealedText` is empty here, so any consumer doing
    // `revealedText || label` is about to display `label` (or nothing) --
    // `usingVerbatim` must be false in that case regardless of what it was
    // computed as above, or the badge would be skipped while a paraphrase
    // (or nothing) is actually on screen (external review finding).
    return { revealedText: '', totalWords, usingVerbatim: false };
  }

  // Bug-2 fix (2026-09-30, live report: caption "at least 50% too fast",
  // out of sync with speech): the reveal is driven by a words-per-second
  // reading pace (Settings Registry `highlights.tickerWordsPerSecond`)
  // instead of spreading all words uniformly across the segment duration.
  // A long excerpt in a short segment now simply doesn't finish revealing
  // (it keeps the last readable position) instead of scrolling faster.
  // floor + fraction keeps steady word pacing even for long texts (the
  // old ceil-on-ratio rushed early words when totalWords >> duration).
  //
  // T10 (2026-10-12, owner: "ticker always 1-3 words behind the speaker"):
  // the fixed pace lags real speech -- stored verbatim excerpts run a median
  // 3.37 words/s (p10 2.6, p90 4.4, 565 rows) against the 2.5 default. A
  // verbatim excerpt IS the segment's speech, so its words over the
  // highlight's raw end - start is the speaker's actual pace. The registry pace
  // stays the fallback for paraphrased labels (the source of the original
  // "too fast" bug-2 report) and for a degenerate speaking window.
  const pace = revealPace(usingVerbatim, totalWords, speakingSeconds, wordsPerSecond);
  // leadInSeconds may be negative: a legacy overlapping clip is shifted to
  // open at the previous clip's end, AFTER its own words began (T8), so the
  // reveal starts that far into the excerpt instead of at word one.
  const speechSeconds = Math.max(0, elapsedSeconds - leadInSeconds);
  const revealedFloat = Math.min(totalWords, Math.max(1, speechSeconds * pace));
  const baseCount = Math.floor(revealedFloat);
  const fraction = revealedFloat - baseCount;
  const revealedWordCount = Math.min(totalWords, baseCount + (fraction > 0 ? 1 : 0));

  const revealedText =
    words.slice(0, revealedWordCount /* ellipsis appended below when truncated */).join(' ') + (revealedWordCount < totalWords ? '...' : '');
  return { revealedText, totalWords, usingVerbatim };
}

/** A caption/transcript segment with its real start, in seconds from the
 *  highlight's own start (the same clock as `elapsedSeconds - leadInSeconds`). */
export interface TimedSegment {
  start: number;
  text: string;
}

/**
 * Word-level start times derived from real segment timings. Each segment's
 * words are spread evenly across that segment's own span (its start to the
 * next segment's start, or to `speakingSeconds` for the last one). Words are
 * interpolated only INSIDE a real segment, never across a gap, so a silence
 * between segments yields no words to reveal and the reveal holds.
 */
export function timedWordStarts(
  segments: ReadonlyArray<TimedSegment>,
  speakingSeconds: number,
): { words: string[]; starts: number[] } {
  const words: string[] = [];
  const starts: number[] = [];
  segments.forEach((segment, i) => {
    const segWords = segment.text.split(/\s+/).filter(Boolean);
    if (segWords.length === 0) return;
    const segStart = segment.start;
    const nextStart = segments[i + 1]?.start ?? speakingSeconds;
    const span = Math.max(0, nextStart - segStart);
    segWords.forEach((word, wordIndex) => {
      words.push(word);
      starts.push(segStart + (wordIndex * span) / segWords.length);
    });
  });
  return { words, starts };
}

/** Static "up next" preview -- first 5-10 words of the upcoming segment's
 *  label, shown before it starts playing (dispatch prompt, section 2). */
export function previewWords(label: string | null, count = 8): string {
  if (!label) return '';
  const words = label.split(/\s+/).filter(Boolean);
  return words.slice(0, count /* ellipsis appended below when truncated */).join(' ') + (words.length > count ? '...' : '');
}
