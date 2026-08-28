import { describe, it, expect } from 'vitest';
import { HighlightSegmentSchema, HighlightsResponseSchema } from '@/lib/validators/highlights';

describe('HighlightSegmentSchema', () => {
  it('accepts canonical { start, end, title } shape', () => {
    const result = HighlightSegmentSchema.parse({
      start: 10,
      end: 20,
      title: 'Key moment',
      summary: 'Important insight',
    });
    expect(result.start).toBe(10);
    expect(result.end).toBe(20);
    expect(result.title).toBe('Key moment');
    expect(result.summary).toBe('Important insight');
  });

  it('aliases start_time / end_time legacy columns', () => {
    const result = HighlightSegmentSchema.parse({
      start_time: 30,
      end_time: 45,
      label: 'Legacy row',
    });
    expect(result.start).toBe(30);
    expect(result.end).toBe(45);
    expect(result.title).toBe('Legacy row');
  });

  it('aliases startTime / endTime camelCase variants', () => {
    const result = HighlightSegmentSchema.parse({
      startTime: 5,
      endTime: 15,
      headline: 'Camel row',
    });
    expect(result.start).toBe(5);
    expect(result.end).toBe(15);
    expect(result.title).toBe('Camel row');
  });

  it('falls back to timestamp when start variants are absent', () => {
    const result = HighlightSegmentSchema.parse({
      timestamp: 42,
      end: 50,
      key_point: 'From timestamp',
    });
    expect(result.start).toBe(42);
    expect(result.title).toBe('From timestamp');
  });

  it('coerces numeric strings for start/end', () => {
    const result = HighlightSegmentSchema.parse({
      start: '  12 ',
      end: ' 18 ',
      title: 'String nums',
    });
    expect(result.start).toBe(12);
    expect(result.end).toBe(18);
  });

  it('defaults title to "Key Insight" when missing or blank', () => {
    const noTitle = HighlightSegmentSchema.parse({ start: 0, end: 10 });
    expect(noTitle.title).toBe('Key Insight');

    const blankTitle = HighlightSegmentSchema.parse({ start: 0, end: 10, title: '   ' });
    expect(blankTitle.title).toBe('Key Insight');
  });

  it('defaults end to start + 12 when end is absent or invalid', () => {
    const missingEnd = HighlightSegmentSchema.parse({ start: 100, title: 'No end' });
    expect(missingEnd.end).toBe(112);

    const invalidEnd = HighlightSegmentSchema.parse({ start: 50, end: 'NaN', title: 'Bad end' });
    expect(invalidEnd.end).toBe(62);
  });

  it('clamps negative start to 0 and defaults end to start+12 when end is negative', () => {
    const result = HighlightSegmentSchema.parse({
      start: -5,
      end: -1,
      title: 'Negative',
    });
    expect(result.start).toBe(0);
    expect(result.end).toBe(12);
  });

  it('enforces end > start: inverted interval clamps end to start + 12', () => {
    const result = HighlightSegmentSchema.parse({ start: 50, end: 10, title: 'Inverted' });
    expect(result.start).toBe(50);
    expect(result.end).toBe(62);
  });

  it('defaults summary to empty string when absent', () => {
    const result = HighlightSegmentSchema.parse({ start: 0, end: 10, title: 'No summary' });
    expect(result.summary).toBe('');
  });

  it('preserves extra fields via passthrough', () => {
    const result = HighlightSegmentSchema.parse({
      start: 0,
      end: 10,
      title: 'Extra',
      idx: 3,
      verbatimExcerpt: 'verbatim text',
      takeawayIdx: 1,
    });
    expect(result.idx).toBe(3);
    expect(result.verbatimExcerpt).toBe('verbatim text');
  });
});

describe('HighlightsResponseSchema', () => {
  it('validates a full response with highlights', () => {
    const result = HighlightsResponseSchema.parse({
      analysisId: '12345678-1234-1234-1234-123456789012',
      highlights: [
        { start: 0, end: 10, title: 'First' },
        { start_time: 20, end_time: 30, label: 'Second' },
      ],
    });
    expect(result.highlights).toHaveLength(2);
    expect(result.highlights[1]!.title).toBe('Second');
  });

  it('validates empty highlights array', () => {
    const result = HighlightsResponseSchema.parse({
      analysisId: '12345678-1234-1234-1234-123456789012',
      highlights: [],
    });
    expect(result.highlights).toHaveLength(0);
  });

  it('rejects non-string analysisId', () => {
    const result = HighlightsResponseSchema.safeParse({
      analysisId: 123,
      highlights: [],
    });
    expect(result.success).toBe(false);
  });
});
