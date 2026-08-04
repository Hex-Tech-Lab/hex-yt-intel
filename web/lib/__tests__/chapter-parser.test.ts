/**
 * Chapter parser — pure extraction of chapter markers from a YouTube
 * description (docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md).
 */
import { describe, it, expect } from 'vitest';
import { parseChapters } from '../../../worker/src/services/chapter-parser';

describe('parseChapters', () => {
  it('returns empty for null/empty descriptions', () => {
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters(undefined)).toEqual([]);
    expect(parseChapters('')).toEqual([]);
  });

  it('parses simple MM:SS chapter lines', () => {
    const chapters = parseChapters('0:00 Introduction\n2:15 Topic A\n5:30 Conclusion');
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 0, end_seconds: 135, label: 'Introduction' });
    expect(chapters[1]).toEqual({ idx: 1, start_seconds: 135, end_seconds: 330, label: 'Topic A' });
    expect(chapters[2]).toEqual({ idx: 2, start_seconds: 330, end_seconds: 390, label: 'Conclusion' });
  });

  it('parses HH:MM:SS and range-form chapter lines', () => {
    const chapters = parseChapters('1:02:30 Deep dive\n1:05:00 – 1:10:00 Extended segment');
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 3750, end_seconds: 3900, label: 'Deep dive' });
    expect(chapters[1]).toEqual({ idx: 1, start_seconds: 3900, end_seconds: 4200, label: 'Extended segment' });
  });

  it('ignores non-chapter lines and blank lines', () => {
    const chapters = parseChapters('\nThis is a description.\n\n0:00 Intro\nLinks below:\n');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 0, end_seconds: 60, label: 'Intro' });
  });

  it('strips a leading dash from the label', () => {
    const chapters = parseChapters('0:00 – Introduction');
    expect(chapters[0]?.label).toBe('Introduction');
  });

  it('drops timestamp-only lines with no label', () => {
    expect(parseChapters('1:23\n2:45 Real label')).toHaveLength(1);
  });
});
