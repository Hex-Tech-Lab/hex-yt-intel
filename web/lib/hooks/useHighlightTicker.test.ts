/**
 * Regression test for useHighlightTicker's 2026-08-20 rewrite (shared-hook
 * extraction, docs/agent-prompts/2026-08-20-cc-simplify-shared-playback-hook.md
 * finding #2): the hook no longer owns its own setInterval/Date.now() timer
 * -- it now derives revealedWordCount purely from an externally-supplied
 * `elapsedSeconds` value on every render. This proves that derivation is
 * correct without needing fake timers (there's no timer left to fake).
 *
 * Follows the renderHook + @vitest-environment happy-dom pattern from
 * AnalysisHistory-restore.test.tsx.
 */

// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHighlightTicker, previewWords } from './useHighlightTicker';

describe('useHighlightTicker', () => {
  it('reveals nothing when not playing (playingIdx null)', () => {
    const { result } = renderHook(() => useHighlightTicker(null, 'one two three four', 10, 5));
    expect(result.current.revealedText).toBe('');
    expect(result.current.totalWords).toBe(4);
  });

  it('reveals nothing when elapsedSeconds is null (time not yet known)', () => {
    const { result } = renderHook(() => useHighlightTicker(0, 'one two three four', 10, null));
    expect(result.current.revealedText).toBe('');
  });

  it('reveals the first word immediately at elapsed=0, not a blank flash', () => {
    const { result } = renderHook(() => useHighlightTicker(0, 'one two three four', 10, 0));
    expect(result.current.revealedText).toBe('one...');
  });

  it('reveals proportionally to elapsed/duration ratio', () => {
    // 4 words over 10s duration; at 5s elapsed (50%) -> ceil(0.5*4)=2 words
    const { result } = renderHook(() => useHighlightTicker(0, 'one two three four', 10, 5));
    expect(result.current.revealedText).toBe('one two...');
  });

  it('reveals all words with no trailing ellipsis once elapsed reaches duration', () => {
    const { result } = renderHook(() => useHighlightTicker(0, 'one two three four', 10, 10));
    expect(result.current.revealedText).toBe('one two three four');
  });

  it('re-derives from a fresh elapsedSeconds on re-render (no internal timer to desync)', () => {
    const { result, rerender } = renderHook(
      ({ elapsed }: { elapsed: number }) => useHighlightTicker(0, 'one two three four', 10, elapsed),
      { initialProps: { elapsed: 0 } }
    );
    expect(result.current.revealedText).toBe('one...');
    rerender({ elapsed: 7.5 });
    expect(result.current.revealedText).toBe('one two three...');
  });

  it('resets when playingIdx changes to a new segment', () => {
    const { result, rerender } = renderHook(
      ({ idx, elapsed }: { idx: number | null; elapsed: number | null }) =>
        useHighlightTicker(idx, 'one two three four', 10, elapsed),
      { initialProps: { idx: 0, elapsed: 10 } }
    );
    expect(result.current.revealedText).toBe('one two three four');
    rerender({ idx: 1, elapsed: 0 });
    expect(result.current.revealedText).toBe('one...');
  });
});

describe('previewWords', () => {
  it('returns empty string for null label', () => {
    expect(previewWords(null)).toBe('');
  });

  it('truncates to the given word count with an ellipsis', () => {
    expect(previewWords('one two three four five six seven eight nine ten', 4)).toBe('one two three four...');
  });

  it('returns the full label with no ellipsis when under the count', () => {
    expect(previewWords('one two three', 8)).toBe('one two three');
  });
});
