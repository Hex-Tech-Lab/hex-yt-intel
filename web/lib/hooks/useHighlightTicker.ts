'use client';

import { useEffect, useRef, useState } from 'react';

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
 * currently active; this hook only owns the word-reveal timer, keyed off
 * that index changing (a new segment starting resets the reveal from word 0).
 */
export function useHighlightTicker(
  playingIdx: number | null,
  label: string | null,
  segmentDurationSeconds: number
): { revealedText: string; totalWords: number } {
  const [revealedWordCount, setRevealedWordCount] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  const words = label ? label.split(/\s+/).filter(Boolean) : [];
  const totalWords = words.length;

  useEffect(() => {
    if (playingIdx === null || totalWords === 0) {
      setRevealedWordCount(0);
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
    setRevealedWordCount(totalWords > 0 ? 1 : 0); // first word visible immediately, not a blank flash

    const durationMs = Math.max(1, segmentDurationSeconds) * 1000;
    const intervalId = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const elapsedMs = Date.now() - startedAt;
      const nextCount = Math.min(totalWords, Math.max(1, Math.ceil((elapsedMs / durationMs) * totalWords)));
      setRevealedWordCount(nextCount);
    }, 150);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // keyed on playingIdx (a new segment starting) + totalWords/duration for
    // that segment, not on `label` string identity churn.
  }, [playingIdx, totalWords, segmentDurationSeconds]);

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
