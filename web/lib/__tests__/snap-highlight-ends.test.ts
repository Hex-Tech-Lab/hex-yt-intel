import { describe, it, expect } from 'vitest';
import { buildHighlightsWindowedUserMessage, snapHighlightEnds, type ExtractedHighlight } from '@/lib/prompts/highlights-extraction';

const segments = [
  { start: 0, text: 'Intro words here.' },
  { start: 10, text: 'We moved the whole stack over,' },
  { start: 18, text: 'and it cut our bill by 40 percent.' },
  { start: 26, text: 'Anyway, next topic.' },
  { start: 40, text: 'Closing line.' },
];
const highlight = (start: number, end: number): ExtractedHighlight => ({ start, end, label: 'x', takeawayIdx: null, verbatimExcerpt: '' });

describe('snapHighlightEnds (T25: clips stopped before the payoff)', () => {
  it('extends a mid-line end to the line boundary, then takes a payoff line with a figure', () => {
    expect(snapHighlightEnds([highlight(10, 15)], segments, 60)[0]?.end).toBe(26);
  });

  it('stops at the line boundary when the next line has no payoff', () => {
    expect(snapHighlightEnds([highlight(18, 20)], segments, 60)[0]?.end).toBe(26);
  });

  it('never extends past start + maxSegmentDuration', () => {
    expect(snapHighlightEnds([highlight(10, 15)], segments, 12)[0]?.end).toBe(18);
    expect(snapHighlightEnds([highlight(10, 15)], segments, 6)[0]?.end).toBe(15);
  });

  it('leaves a highlight ending in the final line (unknown end) alone', () => {
    expect(snapHighlightEnds([highlight(40, 45)], segments, 60)[0]?.end).toBe(45);
  });
});

describe('buildHighlightsWindowedUserMessage – line ends and read-ahead', () => {
  it('shows each line as [start-end] and appends read-only following context', () => {
    const message = buildHighlightsWindowedUserMessage([{ start: 10, end: 18, text: 'a' }], 2, [], [{ start: 300, end: 305, text: 'b' }]);
    expect(message).toContain('[10-18] a');
    expect(message).toContain('FOLLOWING CONTEXT');
    expect(message).toContain('[300-305] b');
  });
});

describe('snapHighlightEnds – review fixes', () => {
  it('does not take a digit line when the current sentence already ended', () => {
    const segs = [{ start: 0, text: 'That is the main point.' }, { start: 10, text: 'We have 5 minutes left.' }, { start: 20, text: 'x' }];
    expect(snapHighlightEnds([highlight(0, 5)], segs, 60)[0]?.end).toBe(10);
  });

  it('takes a "because" line after a completed sentence (FOLLOW_THROUGH)', () => {
    const segs = [{ start: 0, text: 'That is the main point.' }, { start: 10, text: 'because it halves the cost.' }, { start: 20, text: 'x' }];
    expect(snapHighlightEnds([highlight(0, 5)], segs, 60)[0]?.end).toBe(20);
  });

  it('never extends into the next highlight', () => {
    const out = snapHighlightEnds([highlight(10, 15), highlight(18, 30)], segments, 60);
    expect(out[0]?.end).toBe(18);
    expect(out[1]?.start).toBe(18);
  });
});
