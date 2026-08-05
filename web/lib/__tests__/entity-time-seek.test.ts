/**
 * Entity time-seek ranking — the pure "which timestamp wins" logic behind
 * DashboardContainer's handleSelectNode entity-click seek.
 */
import { describe, it, expect } from 'vitest';
import { findEntityTimestamp } from '@/lib/utils/entity-time-seek';

describe('findEntityTimestamp', () => {
  it('prefers a timestamp in the label over one in content', () => {
    const node = {
      label: 'Discussion at 5:30',
      content: 'Unrelated aside mentioning 12:10 happens earlier in the transcript',
      keyTerms: [],
    };
    expect(findEntityTimestamp(node)).toBe('5:30');
  });

  it('falls back to content when the label has no timestamp', () => {
    const node = {
      label: 'Pricing strategy',
      content: 'They cover this starting at 8:42 in detail',
      keyTerms: ['9:15'],
    };
    expect(findEntityTimestamp(node)).toBe('8:42');
  });

  it('falls back to keyTerms when neither label nor content has a timestamp', () => {
    const node = {
      label: 'Pricing strategy',
      content: 'No timing info here',
      keyTerms: ['budget', '3:20'],
    };
    expect(findEntityTimestamp(node)).toBe('3:20');
  });

  it('returns null when no field contains a timestamp', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: ['budget'] };
    expect(findEntityTimestamp(node)).toBeNull();
  });

  it('handles missing/undefined fields gracefully', () => {
    expect(findEntityTimestamp({})).toBeNull();
    expect(findEntityTimestamp({ label: undefined, content: null, keyTerms: undefined })).toBeNull();
  });

  it('falls back to dimension content when node fields have no timestamp, using the nearest preceding timestamp before the label', () => {
    const node = { label: 'Patrick Winston', content: 'No timing info', keyTerms: [] };
    const dimensionContent =
      'At 2:10 we cover intros. At 5:45 Patrick Winston explains the K-P-T formula. Later at 9:00 we move on.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('5:45');
  });

  it('falls back to the first timestamp in dimension content when the label is not found there', () => {
    const node = { label: 'Some entity not in the transcript', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 5:45 something else happens.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('2:10');
  });

  it('does not use the dimension-content fallback when the node itself already has a timestamp', () => {
    const node = { label: 'Discussion at 5:30', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 something unrelated happens.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('5:30');
  });

  it('returns null when dimensionContent is provided but has no timestamps at all', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    expect(findEntityTimestamp(node, 'Nothing time-related here.')).toBeNull();
  });

  it('uses a chapter boundary over regex when the content timestamp falls inside a chapter', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed in detail.';
    const chapters = [
      { start_seconds: 0, end_seconds: 60, label: 'Intro' },
      { start_seconds: 300, end_seconds: 420, label: 'Pricing deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:00');
  });

  it('falls through to regex when no chapter brackets the content timestamp', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed in detail.';
    const chapters = [
      { start_seconds: 600, end_seconds: 720, label: 'Late section' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:45');
  });

  it('behaves identically to before when no chapters are provided', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed.';
    expect(findEntityTimestamp(node, dimensionContent, null)).toBe('5:45');
    expect(findEntityTimestamp(node, dimensionContent, [])).toBe('5:45');
  });

  it('extracts the start time from a range-format timestamp in dimension content', () => {
    const node = { label: 'Apex', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'The Apex framework segment runs from 60:00 to 65:00.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('60:00');
  });

  it('uses the START of a range immediately preceding the label, not the range end (label-proximity branch)', () => {
    const node = { label: 'Entity A', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'Segment: 60:00 to 65:00 Entity A discussion follows.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('60:00');
  });

  it('uses label-proximity timestamp for chapter check, not the first timestamp (P0-4)', () => {
    // Two timestamps, only the second is near the entity label. The chapter
    // check must use the label-proximity timestamp (50:00), not the first one
    // (2:10). The chapter "Deep dive" (40:00-60:00) brackets 50:00, so the
    // result should be the chapter start (40:00), not the raw 50:00.
    const node = { label: 'Entity B', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 50:00 Entity B is discussed in depth.';
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
      { start_seconds: 2400, end_seconds: 3600, label: 'Deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('40:00');
  });

  it('uses the label-proximity timestamp when it falls outside any chapter (P0-4)', () => {
    const node = { label: 'Entity B', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 50:00 Entity B is discussed.';
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
    ];
    // 50:00 = 3000s, falls outside the 0-300s chapter, so return raw 50:00
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('50:00');
  });

  it('resolves an exact shared chapter boundary to the later chapter, not the earlier one', () => {
    const node = { label: 'Entity C', content: '', keyTerms: [] };
    const dimensionContent = 'At 5:00 Entity C is introduced.';
    // 5:00 = 300s sits exactly on the shared boundary between both chapters.
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
      { start_seconds: 300, end_seconds: 600, label: 'Deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:00');
  });

  it('applies chapter-boundary snapping to a literal timestamp in node.label, not just the dimension fallback', () => {
    const node = { label: '10:00 marker', content: '', keyTerms: [] };
    const chapters = [{ start_seconds: 0, end_seconds: 1200, label: 'Full chapter' }];
    // node.label itself contains a timestamp (rare, but must still snap to
    // the covering chapter's start -- this was bypassed before the fix.
    expect(findEntityTimestamp(node, null, chapters)).toBe('0:00');
  });
});
