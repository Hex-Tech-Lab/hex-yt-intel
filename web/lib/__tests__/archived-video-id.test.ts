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

  it('strips the suffix unconditionally, matching SQL, even for an id shorter than 11 chars', () => {
    // Regression test: cubic review, PR #177 re-audit -- an earlier version
    // of this function anchored the regex to a real 11-char YouTube-ID
    // prefix, defending against a theoretical corruption case. That
    // deviated from the SQL SSOT (`regexp_replace(video_id, '_archived_.*$',
    // '')`, which strips unconditionally) and reintroduced the opposite,
    // more likely bug: any video_id that isn't exactly 11 chars would
    // silently keep its archived suffix, leaking it into paths that expect
    // a canonical id. Matching SQL's unconditional behavior exactly.
    expect(stripArchivedVideoIdSuffix('short_archived_1')).toBe('short');
  });
});
