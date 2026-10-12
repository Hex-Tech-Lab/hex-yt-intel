import { describe, it, expect } from 'vitest';
import { normalizeTableRowWidth } from '../markdown-table-width';
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
