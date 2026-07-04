/**
 * Analysis Reaper — salvage-vs-fail decision.
 * The reaper settles stuck `processing` rows: rows with enough generated
 * dimensions are salvaged to `completed`, the rest are `failed`.
 */
import { describe, it, expect } from 'vitest';
import { decideReapOutcome, MIN_SALVAGEABLE_DIMENSIONS } from '@/lib/services/analysis-reaper';

/** Build markdown containing exactly `n` UCIS dimension headers (1..n). */
function markdownWithDimensions(n: number): string {
  return Array.from({ length: n }, (_, i) => `### DIMENSION ${i + 1}: Section ${i + 1}\n\nSome analysis content for dimension ${i + 1}.`).join('\n\n');
}

describe('decideReapOutcome', () => {
  it('fails an empty / null / whitespace analysis (the stuck-with-no-output case)', () => {
    expect(decideReapOutcome(null)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome(undefined)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('')).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('   \n  ')).toEqual({ outcome: 'failed', dimensionCount: 0 });
  });

  it('fails a below-threshold partial (fewer than the salvage minimum)', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS - 1);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS - 1);
    expect(outcome).toBe('failed');
  });

  it('salvages a partial that meets the salvage minimum', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS);
    expect(outcome).toBe('completed');
  });

  it('salvages a full 11-dimension analysis', () => {
    const { outcome, dimensionCount } = decideReapOutcome(markdownWithDimensions(11));
    expect(dimensionCount).toBe(11);
    expect(outcome).toBe('completed');
  });
});
