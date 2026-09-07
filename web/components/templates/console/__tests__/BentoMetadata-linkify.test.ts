import { describe, it, expect } from 'vitest';
import { trimUrlTrailingPunctuation } from '../BentoMetadata';

// RCA (review finding, 2026-09-07): the original URL_PATTERN excluded
// terminal ), ], !, quotes, etc. from ever matching, which truncated valid
// URLs ending in balanced punctuation (Wikipedia-style parenthetical URLs)
// or simply lost trailing characters that were part of the URL. Fixed by
// matching greedily then trimming only genuinely unbalanced/sentence
// punctuation. These tests exercise the trim function directly.
describe('trimUrlTrailingPunctuation', () => {
  it('keeps a balanced trailing parenthesis (Wikipedia-style URL)', () => {
    expect(trimUrlTrailingPunctuation('https://en.wikipedia.org/wiki/Function_(mathematics)'))
      .toBe('https://en.wikipedia.org/wiki/Function_(mathematics)');
  });

  it('keeps a balanced trailing bracket', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/foo[bar]'))
      .toBe('https://example.com/foo[bar]');
  });

  it('strips an unbalanced trailing parenthesis (sentence punctuation)', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/page)'))
      .toBe('https://example.com/page');
  });

  it('strips a trailing period (end of sentence)', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/page.'))
      .toBe('https://example.com/page');
  });

  it('strips multiple trailing punctuation characters', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/page!?'))
      .toBe('https://example.com/page');
  });

  it('strips a trailing quote', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/page"'))
      .toBe('https://example.com/page');
  });

  it('preserves a query string with no trailing punctuation', () => {
    expect(trimUrlTrailingPunctuation('https://example.com/search?q=test&page=2'))
      .toBe('https://example.com/search?q=test&page=2');
  });

  it('handles a URL with no trailing punctuation unchanged', () => {
    expect(trimUrlTrailingPunctuation('https://example.com'))
      .toBe('https://example.com');
  });
});
