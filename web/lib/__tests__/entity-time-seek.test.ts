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
});
