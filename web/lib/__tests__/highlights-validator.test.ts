import { describe, it, expect } from 'vitest';
import { HighlightSegmentSchema, HighlightsResponseSchema } from '@/lib/validators/highlights';

describe('HighlightSegmentSchema', () => {
  it('accepts canonical { start, end, title } shape', () => {
    const result = HighlightSegmentSchema.parse({
      start: 10,
      end: 20,
      title: 'Key moment',
      summary: 'Important insight',
      verbatimExcerpt: null,
      takeawayIdx: null,
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
      verbatimExcerpt: null,
      takeawayIdx: null,
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
      verbatimExcerpt: null,
      takeawayIdx: null,
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
      verbatimExcerpt: null,
      takeawayIdx: null,
    });
    expect(result.start).toBe(42);
    expect(result.title).toBe('From timestamp');
  });

  it('coerces numeric strings for start/end', () => {
    const result = HighlightSegmentSchema.parse({
      start: '  12 ',
      end: ' 18 ',
      title: 'String nums',
      verbatimExcerpt: null,
      takeawayIdx: null,
    });
    expect(result.start).toBe(12);
    expect(result.end).toBe(18);
  });

  it('defaults title to "Key Insight" when missing or blank', () => {
    const noTitle = HighlightSegmentSchema.parse({ start: 0, end: 10, verbatimExcerpt: null, takeawayIdx: null });
    expect(noTitle.title).toBe('Key Insight');

    const blankTitle = HighlightSegmentSchema.parse({ start: 0, end: 10, title: '   ', verbatimExcerpt: null, takeawayIdx: null });
    expect(blankTitle.title).toBe('Key Insight');
  });

  it('defaults end to start + 15 when end is absent or invalid', () => {
    const missingEnd = HighlightSegmentSchema.parse({ start: 100, title: 'No end', verbatimExcerpt: null, takeawayIdx: null });
    expect(missingEnd.end).toBe(115);

    const invalidEnd = HighlightSegmentSchema.parse({ start: 50, end: 'NaN', title: 'Bad end', verbatimExcerpt: null, takeawayIdx: null });
    expect(invalidEnd.end).toBe(65);
  });

  it('clamps negative start to 0 and defaults end to start+15 when end is negative', () => {
    const result = HighlightSegmentSchema.parse({
      start: -5,
      end: -1,
      title: 'Negative',
      verbatimExcerpt: null,
      takeawayIdx: null,
    });
    expect(result.start).toBe(0);
    expect(result.end).toBe(15);
  });

  it('enforces end > start: inverted interval clamps end to start + 15', () => {
    const result = HighlightSegmentSchema.parse({ start: 50, end: 10, title: 'Inverted', verbatimExcerpt: null, takeawayIdx: null });
    expect(result.start).toBe(50);
    expect(result.end).toBe(65);
  });

  it('defaults summary to empty string when absent', () => {
    const result = HighlightSegmentSchema.parse({ start: 0, end: 10, title: 'No summary', verbatimExcerpt: null, takeawayIdx: null });
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

  it('accepts null verbatimExcerpt/takeawayIdx when the keys are present (legitimately no excerpt stored)', () => {
    const result = HighlightSegmentSchema.parse({
      start: 0,
      end: 10,
      title: 'Null contract keys',
      verbatimExcerpt: null,
      takeawayIdx: null,
    });
    expect(result.verbatimExcerpt).toBeNull();
    expect(result.takeawayIdx).toBeNull();
  });

  it('P2b negative control: a snake_case-only object FAILS validation (the PR #281 regression shape)', () => {
    // The exact drift PR #281 introduced and PR #312 restored: DB snake_case
    // keys passed through .passthrough() while the camelCase keys were
    // absent. With the fields required-but-nullable this shape can never
    // pass validation silently again.
    const result = HighlightSegmentSchema.safeParse({
      start: 0,
      end: 10,
      title: 'Snake regression',
      verbatim_excerpt: 'stored text',
      takeaway_idx: 2,
    });
    expect(result.success).toBe(false);
  });

  it('P2b negative control: absent contract keys FAIL validation (presence is enforced, not just shape)', () => {
    const result = HighlightSegmentSchema.safeParse({
      start: 0,
      end: 10,
      title: 'Missing contract keys',
    });
    expect(result.success).toBe(false);
  });

  it('P2b negative control: non-integer takeawayIdx fails even when present', () => {
    const result = HighlightSegmentSchema.safeParse({
      start: 0,
      end: 10,
      title: 'Float takeaway',
      verbatimExcerpt: null,
      takeawayIdx: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('HighlightsResponseSchema', () => {
  it('validates a full response with highlights', () => {
    const result = HighlightsResponseSchema.parse({
      analysisId: '12345678-1234-1234-1234-123456789012',
      highlights: [
        { start: 0, end: 10, title: 'First', verbatimExcerpt: null, takeawayIdx: null },
        { start_time: 20, end_time: 30, label: 'Second', verbatimExcerpt: null, takeawayIdx: null },
      ],
    });
    expect(result.highlights).toHaveLength(2);
    const second = result.highlights[1];
    expect(second).toBeDefined();
    expect(second?.title).toBe('Second');
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
