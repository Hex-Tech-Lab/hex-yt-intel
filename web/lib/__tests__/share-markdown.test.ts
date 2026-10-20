import { describe, it, expect } from 'vitest';
import { toShareMarkdown } from '@/lib/utils/share-markdown';

describe('toShareMarkdown (T23)', () => {
  it('applies the dashboard preprocessing (System line becomes a heading)', () => {
    expect(toShareMarkdown('**System 1: Supabase**')).toContain('##### System 1: Supabase');
  });

  it('keeps timestamps as plain text, never dead #t= links', () => {
    const out = toShareMarkdown('The demo starts at [00:01:23].');
    expect(out).not.toContain('#t=');
    expect(out).toContain('00:01:23');
  });
});
