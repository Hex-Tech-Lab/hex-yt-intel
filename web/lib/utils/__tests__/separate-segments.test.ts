import { describe, it, expect } from 'vitest';
import { separateSegments } from '../highlights-settings';
import { leadInFor } from '@/lib/hooks/useSegmentPlayback';

describe('separateSegments (T8: clips must not overlap or repeat)', () => {
  it('moves an overlapping segment to start where the previous one ends', () => {
    const out = separateSegments([{ start: 10, end: 20 }, { start: 18, end: 30 }]);
    expect(out[1]).toMatchObject({ start: 20, end: 30, leadFloor: 20 });
  });

  it('floors the lead-in at the previous end so a close clip does not replay its tail', () => {
    const [, second] = separateSegments([{ start: 10, end: 20 }, { start: 21, end: 30 }]);
    expect(leadInFor(second!, 2.5)).toBe(20); // not 18.5
  });

  it('leaves the normal lead-in when the gap is wide', () => {
    const [, second] = separateSegments([{ start: 10, end: 20 }, { start: 60, end: 70 }]);
    expect(leadInFor(second!, 2.5)).toBe(57.5);
  });

  it('keeps the first segment untouched and never produces end < start', () => {
    const out = separateSegments([{ start: 5, end: 9 }, { start: 6, end: 8 }]);
    expect(out[0]).toEqual({ start: 5, end: 9 });
    expect(out[1]!.end).toBeGreaterThanOrEqual(out[1]!.start);
  });

  it('gives a wholly contained segment a token length instead of a zero (fallback) end', () => {
    const out = separateSegments([{ start: 10, end: 30 }, { start: 12, end: 20 }]);
    expect(out[1]!.start).toBe(30);
    expect(out[1]!.end).toBeGreaterThan(30);
    expect(out[1]!.end).toBeLessThan(31);
  });
});
