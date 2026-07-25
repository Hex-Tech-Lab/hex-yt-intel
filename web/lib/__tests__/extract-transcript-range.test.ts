import { describe, it, expect } from 'vitest';
import { detectRequestedRange, extractRequestedTranscriptRange } from '@/lib/utils/extract-transcript-range';

const SAMPLE_TRANSCRIPT = [
  '[51:59] ha anta متجوز',
  '[52:06] لا شبان في مصر مشغولين كثير',
  '[52:11] بالثوره مش يشوفوا الجمال',
  '[52:14] دي لكن احنا نحب جمال عشان',
  '[52:56] انا الراجل عندي هنا',
  '[53:02] next minute line',
].join('\n');

describe('detectRequestedRange', () => {
  it('detects "minute N" phrasing', () => {
    expect(detectRequestedRange('minute 52')).toEqual({ startSec: 3120, endSec: 3180 });
  });

  it('detects "min. N" phrasing', () => {
    expect(detectRequestedRange('what was said around min. 52')).toEqual({ startSec: 3120, endSec: 3180 });
  });

  it('detects an explicit mm:ss-to-mm:ss range', () => {
    expect(detectRequestedRange('51:00 to 52:00')).toEqual({ startSec: 3060, endSec: 3120 });
  });

  it('detects a bare-number-only message as a minute reference', () => {
    expect(detectRequestedRange('52')).toEqual({ startSec: 3120, endSec: 3180 });
  });

  it('detects a bare number with trailing punctuation', () => {
    expect(detectRequestedRange('52?')).toEqual({ startSec: 3120, endSec: 3180 });
  });

  it('does NOT treat a number embedded in an unrelated request as a range', () => {
    expect(detectRequestedRange('give me 5 ideas')).toBeNull();
  });

  it('does NOT treat a creative request with no timestamp language as a range', () => {
    expect(detectRequestedRange('summarize the film\'s main themes')).toBeNull();
  });

  it('detects Arabic "الدقيقة N" (minute N, digit after word)', () => {
    expect(detectRequestedRange('إيه اللي اتقال حوالي الدقيقة 52')).toEqual({ startSec: 3120, endSec: 3180 });
  });

  it('detects Arabic "N دقيقة" (digit before word)', () => {
    expect(detectRequestedRange('52 دقيقة')).toEqual({ startSec: 3120, endSec: 3180 });
  });
});

describe('extractRequestedTranscriptRange', () => {
  it('extracts every line within the detected minute, not just the first few', () => {
    const result = extractRequestedTranscriptRange(SAMPLE_TRANSCRIPT, '52');
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(4);
    expect(result!.lines[0]).toContain('52:06');
    expect(result!.lines[3]).toContain('52:56');
    // Boundary lines from adjacent minutes must be excluded.
    expect(result!.lines.some(l => l.includes('51:59'))).toBe(false);
    expect(result!.lines.some(l => l.includes('53:02'))).toBe(false);
  });

  it('returns null when the message has no range reference', () => {
    expect(extractRequestedTranscriptRange(SAMPLE_TRANSCRIPT, 'summarize the plot')).toBeNull();
  });

  it('returns an empty-lines result (not null) when the range is valid but the source has nothing there', () => {
    const result = extractRequestedTranscriptRange(SAMPLE_TRANSCRIPT, 'minute 5');
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(0);
  });

  it('defaults to no lead-in buffer when leadInSeconds is omitted (backward compatible)', () => {
    const result = extractRequestedTranscriptRange(SAMPLE_TRANSCRIPT, '52');
    expect(result!.lines.some(l => l.includes('51:59'))).toBe(false);
  });

  it('widens the start of the window earlier by leadInSeconds, pulling in lead-in context', () => {
    // "minute 52" -> startSec 3120 (52:00). The 51:59 line sits 1s before
    // that boundary; a 5s lead-in buffer should now include it.
    const result = extractRequestedTranscriptRange(SAMPLE_TRANSCRIPT, 'minute 52', 5);
    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(5);
    expect(result!.lines[0]).toContain('51:59');
    expect(result!.lines.some(l => l.includes('53:02'))).toBe(false);
    // The caller-facing range metadata reflects the ORIGINAL requested
    // range, not the widened line-selection window.
    expect(result!.startSec).toBe(3120);
    expect(result!.endSec).toBe(3180);
  });

  it('clamps the lead-in buffer at 0 rather than going negative near the start of the video', () => {
    const nearStartTranscript = '[00:02] opening line\n[00:10] second line';
    const result = extractRequestedTranscriptRange(nearStartTranscript, '0', 10);
    expect(result).not.toBeNull();
    // startSec would be 0 - 10 = -10 without clamping; clamped to 0 instead,
    // so both lines (which are >= 0) remain included, nothing throws or
    // silently drops valid lines due to an out-of-range negative window.
    expect(result!.lines).toHaveLength(2);
  });
});
