import { describe, it, expect } from 'vitest';
import { linkifyTimestamps } from '../format';

describe('linkifyTimestamps – backticked timestamps', () => {
  it('turns a backticked lone timestamp into a link, dropping the backticks', () => {
    expect(linkifyTimestamps('See `[00:05:00]` for details')).toBe(
      'See [⏱ 00:05:00](#t=300) for details',
    );
  });

  it('turns a backticked range into two links', () => {
    expect(linkifyTimestamps('Span `[00:07:30]–[00:08:30]` here')).toBe(
      'Span [⏱ 00:07:30](#t=450)–[⏱ 00:08:30](#t=510) here',
    );
  });

  it('leaves backticked non-timestamp code unchanged', () => {
    const input = 'Run `npm test` or `at 00:05:00 later` now';
    expect(linkifyTimestamps(input)).toBe(input);
  });

  it('leaves a timestamp inside a fenced code block unchanged', () => {
    const input = '```\n[00:05:00]\n`00:05:00`\n```';
    expect(linkifyTimestamps(input)).toBe(input);
  });
});

describe('linkifyTimestamps – duration rows (T12)', () => {
  it('does not turn a Duration table cell into a seek link', () => {
    const row = '| Duration | 00:17:41 |';
    expect(linkifyTimestamps(row)).toBe(row);
  });
  it('still links timestamps in other table rows', () => {
    expect(linkifyTimestamps('| Hook | 00:01:05 |')).toContain('#t=');
  });
});

describe('linkifyTimestamps – duration label matching', () => {
  it('skips "Total Duration"', () => {
    const row = '| Total Duration | 00:17:41 |';
    expect(linkifyTimestamps(row)).toBe(row);
  });
  it('still links a row whose label only starts with Duration', () => {
    expect(linkifyTimestamps('| Duration of hook | 00:00:30 |')).toContain('#t=');
  });
});
