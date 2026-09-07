'use client';

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
 */
export function useHighlightTicker(
  playingIdx: number | null,
  label: string | null,
  segmentDurationSeconds: number,
  elapsedSeconds: number | null,
  verbatimExcerpt?: string | null,
): { revealedText: string; totalWords: number; usingVerbatim: boolean } {
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

  const durationSeconds = Math.max(1, segmentDurationSeconds);
  const revealedWordCount = Math.min(
    totalWords,
    Math.max(1, Math.ceil((elapsedSeconds / durationSeconds) * totalWords))
  );

  const revealedText =
    words.slice(0, revealedWordCount /* ellipsis appended below when truncated */).join(' ') + (revealedWordCount < totalWords ? '...' : '');
  return { revealedText, totalWords, usingVerbatim };
}

/** Static "up next" preview -- first 5-10 words of the upcoming segment's
 *  label, shown before it starts playing (dispatch prompt, section 2). */
export function previewWords(label: string | null, count = 8): string {
  if (!label) return '';
  const words = label.split(/\s+/).filter(Boolean);
  return words.slice(0, count /* ellipsis appended below when truncated */).join(' ') + (words.length > count ? '...' : '');
}
