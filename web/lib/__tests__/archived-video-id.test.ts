import { describe, it, expect } from 'vitest';
import { stripArchivedVideoIdSuffix } from '@/lib/utils/archived-video-id';

describe('stripArchivedVideoIdSuffix', () => {
  it('strips the suffix following a real 11-char video id', () => {
    expect(stripArchivedVideoIdSuffix('dQw4w9WgXcQ_archived_1785407155.751134')).toBe('dQw4w9WgXcQ');
  });

  it('returns undefined for null/undefined input', () => {
    expect(stripArchivedVideoIdSuffix(null)).toBeUndefined();
    expect(stripArchivedVideoIdSuffix(undefined)).toBeUndefined();
  });

  it('passes through a plain id with no suffix unchanged', () => {
    expect(stripArchivedVideoIdSuffix('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('does not truncate an id shorter than 11 chars that happens to contain the literal suffix text', () => {
    // Regression test: cubic review, PR #177 -- the previous unanchored
    // regex (/_archived_.*$/) stripped anything matching regardless of
    // what preceded it, so a short id containing this substring would be
    // silently truncated (potentially to '') instead of passed through.
    expect(stripArchivedVideoIdSuffix('short_archived_1')).toBe('short_archived_1');
  });
});
