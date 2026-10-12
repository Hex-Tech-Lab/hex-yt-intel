import { describe, it, expect } from 'vitest';
import { normalizeTableRowWidth, stripRateFormula } from '../markdown-table-width';
import { preprocessMarkdown } from '../format';

describe('normalizeTableRowWidth', () => {
  it('merges the extra cells of the Nate Herk row into the last cell', () => {
    const input = [
      '| Field | Value |',
      '| --- | --- |',
      '| Channel | Nate Herk | AI Automation (no URL in input) |',
    ].join('\n');
    expect(normalizeTableRowWidth(input)).toBe([
      '| Field | Value |',
      '| --- | --- |',
      '| Channel | Nate Herk \\| AI Automation (no URL in input) |',
    ].join('\n'));
  });

  it('leaves a normal table unchanged', () => {
    const input = [
      '| Field | Value |',
      '| --- | --- |',
      '| Channel | Nate Herk |',
      '| Subs | 100k |',
    ].join('\n');
    expect(normalizeTableRowWidth(input)).toBe(input);
  });

  it('leaves non-table text containing pipes unchanged', () => {
    const input = 'Use a | b | c to pipe output.\nA | B | C | D\n\n```\n| x | y |\n| a | b | c |\n```';
    expect(normalizeTableRowWidth(input)).toBe(input);
  });
});

describe('preprocessMarkdown with a literal pipe in a table cell', () => {
  it('renders the Nate Herk table with a 2-column header and no extra column', () => {
    const out = preprocessMarkdown([
      '| Field | Value |',
      '| --- | --- |',
      '| Channel | Nate Herk | AI Automation (no URL in input) |',
    ].join('\n'));
    const rows = out.split(/\r?\n/);
    expect(rows[0]).toBe('| Field | Value |');
    expect(rows[1]).toBe('|---|---|');
    expect(rows[2]).toBe('| Channel | Nate Herk \\| AI Automation (no URL in input) |');
  });
});

describe('stripRateFormula', () => {
  it('keeps only the computed engagement rate', () => {
    expect(stripRateFormula('| Engagement Rate | (3,524 + 324) / 237,282 x 100 = 1.62% |')).toBe('| Engagement Rate | 1.62% |');
  });
  it('leaves a plain value and other rows alone', () => {
    const input = '| Engagement Rate | 1.62% |\n| Views | 237,282 |';
    expect(stripRateFormula(input)).toBe(input);
  });
});

describe('table pre-pass edge cases', () => {
  it('does not merge a trailing empty padding cell', () => {
    const input = '| A | B |\n|---|---|\n| a | b | |';
    expect(normalizeTableRowWidth(input)).toBe(input);
  });
  it('leaves an Engagement Rate row inside a fenced block untouched', () => {
    const input = '```\n| Engagement Rate | (1 + 1) / 100 x 100 = 2% |\n```';
    expect(stripRateFormula(input)).toBe(input);
  });
});

describe('fence handling (``` and ~~~)', () => {
  it('leaves a ~~~ fenced block containing a section line and a table row untouched', () => {
    const input = '~~~\n3.1 Title: x\n| A | B |\n|---|---|\n| a | b | c |\n~~~';
    expect(normalizeTableRowWidth(input)).toBe(input);
    expect(stripRateFormula(input)).toBe(input);
  });

  it('does not close a 4-backtick fence on a 3-backtick line', () => {
    const input = '````\n```\n| A | B |\n|---|---|\n| a | b | c |\n````\n| A | B |\n|---|---|\n| a | b | c |';
    expect(normalizeTableRowWidth(input)).toBe([
      '````',
      '```',
      '| A | B |',
      '|---|---|',
      '| a | b | c |',
      '````',
      '| A | B |',
      '|---|---|',
      '| a | b \\| c |',
    ].join('\n'));
  });
});

describe('escaped pipes', () => {
  it('treats \\\\| (escaped backslash, then a separator) as a column break', () => {
    const input = '| A | B |\n|---|---|\n| x \\\\| y | z |';
    expect(normalizeTableRowWidth(input)).toBe('| A | B |\n|---|---|\n| x \\\\ | y \\| z |');
  });

  it('keeps \\| (escaped pipe) inside a cell', () => {
    const input = '| A | B |\n|---|---|\n| x \\| y | z |';
    expect(normalizeTableRowWidth(input)).toBe(input);
  });
});
