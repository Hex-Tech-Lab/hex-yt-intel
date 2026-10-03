import { describe, it, expect } from 'vitest';
import { annotateWithTimeMarkers, formatClock } from '@/lib/jev/transcript-time-markers';
import { sliceText, tokenizeTranscript } from '@/lib/jev/transcript-slice';

// 2-word segments every 10 s: "w0 w1" @0, "w2 w3" @10, ... 200 words over ~1000 s.
const SEGMENTS = Array.from({ length: 100 }, (unusedSlot, index) => ({ start: index * 10, text: `w${index * 2} w${index * 2 + 1}` }));
const FULL = SEGMENTS.map((segment) => segment.text).join(' ');

describe('formatClock', () => {
  it('formats HH:MM:SS', () => {
    expect([formatClock(0), formatClock(59.9), formatClock(3725.4), formatClock(18891)]).toEqual(['00:00:00', '00:00:59', '01:02:05', '05:14:51']);
  });
});

describe('annotateWithTimeMarkers', () => {
  it('K=1: markers from 00:00:00 every 30 s and a header for the whole range', () => {
    const out = annotateWithTimeMarkers(FULL, SEGMENTS, { startWord: 0, durationSeconds: 1000 });
    expect(out?.startSeconds).toBe(0);
    expect(out?.endSeconds).toBe(990);
    expect(out?.text).toContain('covers 00:00:00–00:16:30 of a 00:16:40 video');
    expect(out?.text).toContain('[00:00:00] w0 w1 w2 w3 w4 w5 [00:00:30] w6');
    expect(out?.text.match(/\[\d\d:\d\d:\d\d\]/g)?.length).toBe(34); // 0..990 s in 30 s steps; the header has none
  });

  it('K>1 slice: real absolute times, never restarting at zero', () => {
    const words = tokenizeTranscript(FULL);
    const slice = sliceText(words, 120, 160); // words 120..159 = 600..790 s
    const out = annotateWithTimeMarkers(slice, SEGMENTS, { startWord: 120 });
    expect(out?.startSeconds).toBe(600);
    expect(out?.text).toContain('covers 00:10:00–00:13:10');
    expect(out?.text).toContain('[00:10:00] w120');
    expect(out?.text).not.toContain('[00:00:00]');
  });

  it('the words themselves are unchanged (only markers and the header are added)', () => {
    const slice = sliceText(tokenizeTranscript(FULL), 40, 80);
    const out = annotateWithTimeMarkers(slice, SEGMENTS, { startWord: 40 });
    const body = out?.text.split('\n\n')[1] ?? '';
    expect(body.replace(/\[\d\d:\d\d:\d\d\] /g, '')).toBe(slice);
  });

  it('falls back (null) when segments are missing or do not line up with the text', () => {
    expect(annotateWithTimeMarkers(FULL, undefined, { startWord: 0 })).toBeNull();
    expect(annotateWithTimeMarkers(FULL, [], { startWord: 0 })).toBeNull();
    expect(annotateWithTimeMarkers('different words entirely', SEGMENTS, { startWord: 0 })).toBeNull();
    expect(annotateWithTimeMarkers(FULL, SEGMENTS, { startWord: 1 })).toBeNull(); // offset mismatch
    expect(annotateWithTimeMarkers('w198 w199 w200', SEGMENTS, { startWord: 198 })).toBeNull(); // runs past the end
  });

  it('the range ends at the last segment END (start + duration), not its start', () => {
    const timed = SEGMENTS.map((segment) => ({ ...segment, duration: 10 }));
    expect(annotateWithTimeMarkers(FULL, timed, { startWord: 0 })?.endSeconds).toBe(1000);
  });

  it('a segment with a bad start keeps its words aligned and inherits the previous time', () => {
    const broken = SEGMENTS.map((segment, index) => (index === 5 ? { ...segment, start: Number.NaN } : segment));
    const out = annotateWithTimeMarkers(FULL, broken, { startWord: 0 });
    expect(out).not.toBeNull();
    expect(out?.endSeconds).toBe(990);
  });

  it('maxChars: the budget is spent on PLAIN words; only the visible words are annotated, with a notice', () => {
    const out = annotateWithTimeMarkers(FULL, SEGMENTS, { startWord: 0, maxChars: 30 }); // "w0 w1 ... w9" = 29 chars
    expect(out?.truncated).toBe(true);
    expect(out?.endSeconds).toBe(40); // w9 starts at 40 s
    expect(out?.text).toContain('covers 00:00:00–00:00:40');
    expect(out?.text).toContain('w9');
    expect(out?.text).not.toContain('w10');
    expect(out?.text).toContain('excerpt truncated to fit the prompt budget');
    expect(annotateWithTimeMarkers(FULL, SEGMENTS, { startWord: 0, maxChars: 100000 })?.truncated).toBe(false);
  });

  it('clamps an unsigned client interval to [5, 300] s (a 0.001 s interval must not mark every word)', () => {
    const count = (interval: number) => annotateWithTimeMarkers(FULL, SEGMENTS, { startWord: 0, intervalSeconds: interval })?.text.match(/\[\d\d:\d\d:\d\d\]/g)?.length;
    expect(count(0.001)).toBe(count(5)); // 0..990 s at 10 s segment spacing -> one marker per segment start, not per word
    expect(count(5)).toBe(100);
    expect(count(100000)).toBe(count(300));
  });

  it('never presents provider-invented times as real: any estimated segment => plain text', () => {
    const invented = SEGMENTS.map((segment, index) => (index === 3 ? { ...segment, estimated: true } : segment));
    expect(annotateWithTimeMarkers(FULL, invented, { startWord: 0 })).toBeNull();
  });
});

