import { describe, expect, it } from 'vitest';
import { timedWordStarts, useHighlightTicker, type TimedSegment } from './useHighlightTicker';

// Two caption segments with a 2s silence between them: "one two three" spoken
// over 0-1.5s, silence 1.5-3.5s, "four five" spoken over 3.5-4.5s.
const SEGMENTS: TimedSegment[] = [
  { start: 0, text: 'one two three' },
  { start: 3.5, text: 'four five' },
];
const SPEAKING = 4.5;

function useTickerAt(elapsed: number, segments: TimedSegment[] | null = SEGMENTS) {
  return useHighlightTicker(0, 'paraphrase label that must not show', SPEAKING, elapsed, null, 2.5, 0, segments);
}

describe('timedWordStarts', () => {
  it('spreads each segment words evenly across that segment span only', () => {
    const { words, starts } = timedWordStarts(SEGMENTS, SPEAKING);
    expect(words).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(starts[0]).toBeCloseTo(0);
    expect(starts[1]).toBeCloseTo(3.5 / 3);
    expect(starts[2]).toBeCloseTo(7 / 3);
    // The second segment starts at its real timing, not at a paced offset.
    expect(starts[3]).toBeCloseTo(3.5);
    expect(starts[4]).toBeCloseTo(4.0);
  });
});

describe('useHighlightTicker speech timing', () => {
  it('(a) advances only as media time advances', () => {
    expect(useTickerAt(0.1).revealedText).toBe('one...');
    expect(useTickerAt(1.2).revealedText).toBe('one two...');
    expect(useTickerAt(1.2).usingVerbatim).toBe(true);
  });

  it('(b) holds across a silence when elapsed is flat', () => {
    // "three" starts at 2.33s, inside the first segment, so it is shown by 2.5s.
    const during = useTickerAt(2.5).revealedText;
    expect(during).toBe('one two three...');
    expect(useTickerAt(3.0).revealedText).toBe(during);
  });

  it('(c) never reveals a word before its own start time', () => {
    // Word "four" starts at 3.5s; at 3.4s it must still be hidden.
    expect(useTickerAt(3.4).revealedText).not.toContain('four');
    expect(useTickerAt(3.5).revealedText).toContain('four');
  });

  it('(d) falls back to the registry pace when no timings exist', () => {
    // 4 words over 4.5s clamps to the 1.5 w/s floor: at 1.0s, 1.5 words -> 2 shown.
    const fallback = useHighlightTicker(0, 'alpha beta gamma delta', SPEAKING, 1.0, 'alpha beta gamma delta', 2.5, 0, null);
    expect(fallback.revealedText).toBe('alpha beta...');
    const noSegments = useHighlightTicker(0, 'alpha beta gamma delta', SPEAKING, 1.0, 'alpha beta gamma delta', 2.5, 0, []);
    expect(noSegments.revealedText).toBe(fallback.revealedText);
  });

  it('(e) a legacy row with no timings and no excerpt still renders the label', () => {
    const legacy = useHighlightTicker(0, 'only a label', SPEAKING, 0, null, 2.5, 0, undefined);
    expect(legacy.totalWords).toBe(3);
    expect(legacy.revealedText).toBe('only...');
  });

  it('reveals the first word at elapsed 0, not a blank flash', () => {
    expect(useTickerAt(0).revealedText).toBe('one...');
  });
});
