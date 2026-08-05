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
    expect(chapters[2]).toEqual({ idx: 2, start_seconds: 330, end_seconds: Number.MAX_SAFE_INTEGER, label: 'Conclusion' });
  });

  it('parses HH:MM:SS and range-form chapter lines', () => {
    const chapters = parseChapters('1:02:30 Deep dive\n1:05:00 – 1:10:00 Extended segment');
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 3750, end_seconds: 3900, label: 'Deep dive' });
    expect(chapters[1]).toEqual({ idx: 1, start_seconds: 3900, end_seconds: 4200, label: 'Extended segment' });
  });

  it('ignores non-chapter lines and blank lines', () => {
    const chapters = parseChapters('\nThis is a description.\n\n0:00 Intro\nLinks below:\n');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 0, end_seconds: Number.MAX_SAFE_INTEGER, label: 'Intro' });
  });

  it('strips a leading dash from the label', () => {
    const chapters = parseChapters('0:00 – Introduction');
    expect(chapters[0]?.label).toBe('Introduction');
  });

  it('drops timestamp-only lines with no label', () => {
    expect(parseChapters('1:23\n2:45 Real label')).toHaveLength(1);
  });

  it('rejects a malformed timestamp with out-of-range seconds', () => {
    const chapters = parseChapters('0:00 Intro\n0:60 Bad seconds\n2:00 Valid chapter');
    expect(chapters).toHaveLength(2);
    expect(chapters.map((chapter) => chapter.label)).toEqual(['Intro', 'Valid chapter']);
  });

  it('rejects a malformed HH:MM:SS timestamp with out-of-range minutes', () => {
    const chapters = parseChapters('1:60:00 Bad minutes\n0:00 Valid chapter');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.label).toBe('Valid chapter');
  });

  it('allows total minutes over 59 when no hours group is present (long-video MM:SS convention)', () => {
    const chapters = parseChapters('75:30 Deep into a long video');
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 4530, end_seconds: Number.MAX_SAFE_INTEGER, label: 'Deep into a long video' });
  });

  it('parses a "to"-separated range and strips it from the label', () => {
    const chapters = parseChapters('0:00 to 1:00 Introduction\n1:00 to 2:00 Deep dive');
    expect(chapters[0]).toEqual({ idx: 0, start_seconds: 0, end_seconds: 60, label: 'Introduction' });
    expect(chapters[1]).toEqual({ idx: 1, start_seconds: 60, end_seconds: 120, label: 'Deep dive' });
  });

  it('falls back to the no-explicit-end path when the range end is malformed, instead of silently converting it', () => {
    const chapters = parseChapters('0:00 to 1:99 Bad range end\n5:00 Next chapter');
    // 1:99 is invalid (seconds > 59) -- end_seconds must NOT be
    // timeToSeconds('1:99')=159; it should fall through to the second-pass
    // fill (next chapter's start, since one exists here).
    expect(chapters[0]?.start_seconds).toBe(0);
    expect(chapters[0]?.end_seconds).toBe(300);
    expect(chapters[0]?.end_seconds).not.toBe(159);
  });
});
