/**
 * Format-aware UCIS dimension counting — the single source of truth that must
 * agree whether an analysis was persisted as a ```json-fenced payload or as
 * stitched "### DIMENSION N" markdown.
 */
import { describe, it, expect } from 'vitest';
import { parseUcisDimensionNumbers, countUcisDimensions } from '@/lib/utils/count-ucis-dimensions';

function markdownHeaders(nums: number[]): string {
  return nums.map((n) => `### DIMENSION ${n}: Section ${n}\n\nBody for ${n}.`).join('\n\n');
}

function jsonFenced(nums: number[]): string {
  const payload = {
    schemaVersion: '2.0',
    dimensions: nums.map((n) => ({ number: n, name: `Dim ${n}`, content: 'x' })),
  };
  const fence = '```';
  return `${fence}json\n${JSON.stringify(payload, null, 2)}\n${fence}`;
}

describe('parseUcisDimensionNumbers', () => {
  it('returns [] for empty/nullish input', () => {
    expect(parseUcisDimensionNumbers(null)).toEqual([]);
    expect(parseUcisDimensionNumbers(undefined)).toEqual([]);
    expect(parseUcisDimensionNumbers('   ')).toEqual([]);
  });

  it('counts the ```json-fenced payload format (the case the old parser missed)', () => {
    expect(parseUcisDimensionNumbers(jsonFenced([5, 7, 10]))).toEqual([5, 7, 10]);
    expect(countUcisDimensions(jsonFenced([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBe(11);
  });

  it('counts the "### DIMENSION N" markdown format', () => {
    expect(parseUcisDimensionNumbers(markdownHeaders([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(countUcisDimensions(markdownHeaders([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(8);
  });

  it('handles a bare (unfenced) JSON payload', () => {
    const payload = JSON.stringify({ dimensions: [{ number: 2 }, { number: 4 }] });
    expect(parseUcisDimensionNumbers(payload)).toEqual([2, 4]);
  });

  it('dedupes and clamps out-of-range dimension numbers in JSON', () => {
    const payload = jsonFenced([3, 3, 5, 0, 12, 11]);
    expect(parseUcisDimensionNumbers(payload)).toEqual([3, 5, 11]);
  });

  it('falls back to markdown parsing when the fenced body is not valid JSON', () => {
    const truncated = '```json\n{ "dimensions": [ { "number": 1 }, { "num'; // cut off mid-stream
    expect(parseUcisDimensionNumbers(truncated)).toEqual([]);
  });

  it('ignores a mid-line cross-reference in markdown (line-anchored)', () => {
    const md = '### DIMENSION 1: A\n\nSee ### DIMENSION 9 above for detail.\n\n### DIMENSION 2: B';
    expect(parseUcisDimensionNumbers(md)).toEqual([1, 2]);
  });
});
