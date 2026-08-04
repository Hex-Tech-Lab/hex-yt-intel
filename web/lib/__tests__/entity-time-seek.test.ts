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
});
