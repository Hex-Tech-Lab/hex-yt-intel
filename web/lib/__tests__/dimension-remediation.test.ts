/**
 * Dimension Remediation — missing-dimension detection.
 * Pure logic only (computeMissingDimensions); the DB/worker-calling paths
 * (findAnalysesWithMissingDimensions, remediateAnalysis, runRemediationHarness)
 * need a live Supabase/Redis/worker and are exercised via the live read-only
 * targeting-query verification documented in docs/specs/
 * remediate-missing-dimensions-design.md, not unit tests.
 */
import { describe, it, expect } from 'vitest';

import { computeMissingDimensions } from '@/lib/services/dimension-remediation';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/** Build markdown containing UCIS dimension headers for exactly the given numbers. */
function markdownWithDimensions(numbers: number[]): string {
  return numbers
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
}

describe('computeMissingDimensions', () => {
  it('returns all dimensions missing for empty markdown', () => {
    expect(computeMissingDimensions('')).toEqual(
      Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1)
    );
  });

  it('returns nothing missing for a complete analysis', () => {
    const all = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1);
    expect(computeMissingDimensions(markdownWithDimensions(all))).toEqual([]);
  });

  it('detects a single missing dimension in the middle', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => n !== 5);
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([5]);
  });

  it('detects multiple non-contiguous missing dimensions', () => {
    const present = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => ![2, 7, 11].includes(n));
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([2, 7, 11]);
  });

  it('detects a trailing gap (dimensions present 1..8 only, the exact LLMCascade-crash shape)', () => {
    const present = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(computeMissingDimensions(markdownWithDimensions(present))).toEqual([9, 10, 11]);
  });
});
