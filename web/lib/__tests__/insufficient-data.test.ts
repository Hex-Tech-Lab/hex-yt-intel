import { describe, it, expect } from 'vitest';
import { shortenInsufficientData, INSUFFICIENT_DATA_LABEL } from '@/lib/utils/insufficient-data';
import { preprocessMarkdown } from '@/lib/utils/format';

const FULL = '[Insufficient data in source transcript to fulfill this dimension]';

describe('shortenInsufficientData (T24)', () => {
  it.each([
    [`- **Lead Value**: ${FULL}`, `- **Lead Value**: ${INSUFFICIENT_DATA_LABEL}`],
    [`| Risk | ${FULL} |`, `| Risk | ${INSUFFICIENT_DATA_LABEL} |`],
    ["Contrarian: '[Insufficient data...]'", `Contrarian: ${INSUFFICIENT_DATA_LABEL}`],
    [`${FULL}. Next sentence.`, `${INSUFFICIENT_DATA_LABEL}. Next sentence.`],
  ])('shortens %s', (input, expected) => {
    expect(shortenInsufficientData(input)).toBe(expected);
  });

  it('leaves unrelated brackets alone', () => {
    expect(shortenInsufficientData('[00:01:23] and [Insufficient sleep] stay')).toBe('[00:01:23] and [Insufficient sleep] stay');
  });

  it.each([
    ['[Insufficient data quality in the sample, n=3]'],
    ['[Insufficient data quality in the sample]'],
    ['[Insufficient data in source transcript to fulfill this dimension, see note]'],
    ['[insufficient data]'],
    ['[insufficient data...]'],
    ['[INSUFFICIENT DATA...]'],
  ])('leaves prefix collisions and lowercase/other-case forms untouched: %s', (note) => {
    expect(shortenInsufficientData(note)).toBe(note);
  });

  it.each([
    ['[Insufficient data in source transcript to fulfill this dimension]'],
    ['[Insufficient data...]'],
  ])('rewrites the exact prompt-emitted form %s', (form) => {
    expect(shortenInsufficientData(form)).toBe(INSUFFICIENT_DATA_LABEL);
  });

  it('runs inside preprocessMarkdown', () => {
    expect(preprocessMarkdown(`**Field**: ${FULL}`)).toContain(INSUFFICIENT_DATA_LABEL);
  });
});
