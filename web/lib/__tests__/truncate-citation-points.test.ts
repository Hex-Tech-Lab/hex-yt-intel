import { describe, it, expect } from 'vitest';
import { truncateCitationPoints, EXPAND_MARKER_PATTERN } from '@/lib/utils/citation-truncate';

function citationTable(point: string): string {
  return ['| Timestamp | Point |', '| --- | --- |', `| 12:10 | ${point} |`].join('\n');
}

describe('truncateCitationPoints', () => {
  it('leaves a short Point cell untouched', () => {
    const md = citationTable('Short point.');
    expect(truncateCitationPoints(md)).toBe(md);
  });

  it('truncates a long Point cell at a word boundary and embeds an EXPAND marker', () => {
    const long = `${'a'.repeat(20)} ${'b'.repeat(150)}`;
    const result = truncateCitationPoints(citationTable(long));
    expect(result).toContain('⟦EXPAND:');
    const match = [...result.matchAll(EXPAND_MARKER_PATTERN)][0];
    expect(match).toBeTruthy();
    const decoded = decodeURIComponent(match?.[1] ?? '');
    // The tail must live inside the marker payload, not as visible text
    // before it -- the "head" text preceding the marker is the part
    // actually rendered without a click.
    const visibleHead = result.slice(0, result.indexOf('⟦EXPAND:'));
    expect(visibleHead).not.toContain('b'.repeat(150));
    // Decoded remainder + visible head should reconstruct the original text.
    expect(decoded.trim().endsWith('b'.repeat(150))).toBe(true);
  });

  it('does not touch the transcript table (different header)', () => {
    const md = ['| Time | Speaker | Line |', '| --- | --- | --- |', `| 0:01 | A | ${'x'.repeat(200)} |`].join('\n');
    expect(truncateCitationPoints(md)).toBe(md);
  });

  it('does not touch prose outside any table', () => {
    const prose = 'y'.repeat(300);
    expect(truncateCitationPoints(prose)).toBe(prose);
  });

  it('is idempotent -- running twice does not double-truncate an already-marked cell', () => {
    const long = 'c'.repeat(200);
    const once = truncateCitationPoints(citationTable(long));
    const twice = truncateCitationPoints(once);
    expect(twice).toBe(once);
  });

  it('handles multiple rows under one header independently', () => {
    const md = [
      '| Timestamp | Point |',
      '| --- | --- |',
      `| 1:00 | ${'p'.repeat(200)} |`,
      `| 2:00 | short |`,
      `| 3:00 | ${'q'.repeat(200)} |`,
    ].join('\n');
    const result = truncateCitationPoints(md);
    const markers = [...result.matchAll(EXPAND_MARKER_PATTERN)];
    expect(markers.length).toBe(2);
    expect(result).toContain('| 2:00 | short |');
  });
});
