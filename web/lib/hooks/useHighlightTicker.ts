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
  elapsedSeconds: number | null
): { revealedText: string; totalWords: number } {
  const words = label ? label.split(/\s+/).filter(Boolean) : [];
  const totalWords = words.length;

  if (playingIdx === null || totalWords === 0 || elapsedSeconds === null) {
    return { revealedText: '', totalWords };
  }

  const durationSeconds = Math.max(1, segmentDurationSeconds);
  const revealedWordCount = Math.min(
    totalWords,
    Math.max(1, Math.ceil((elapsedSeconds / durationSeconds) * totalWords))
  );

  const revealedText =
    words.slice(0, revealedWordCount /* ellipsis appended below when truncated */).join(' ') + (revealedWordCount < totalWords ? '...' : '');
  return { revealedText, totalWords };
}

/** Static "up next" preview -- first 5-10 words of the upcoming segment's
 *  label, shown before it starts playing (dispatch prompt, section 2). */
export function previewWords(label: string | null, count = 8): string {
  if (!label) return '';
  const words = label.split(/\s+/).filter(Boolean);
  return words.slice(0, count /* ellipsis appended below when truncated */).join(' ') + (words.length > count ? '...' : '');
}
