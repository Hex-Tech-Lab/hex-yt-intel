/**
 * Comments sampling engine — Phase 0 statistics module.
 * Locks Cochran's formula, tier resolution, auto-expand, and the
 * two-dimensional stratified sampler's allocation/index behavior.
 */
import {
  cochranSampleSize,
  resolveTierSampleCount,
  needsAutoExpand,
  stratifiedSampleIndices,
  type StratifiableComment,
} from '@/lib/services/comment-sampling';

const COCHRAN_95 = { zScore: 1.96, marginOfError: 0.05, pEstimate: 0.5 };

describe('cochranSampleSize', () => {
  it('returns 0 for a non-positive population', () => {
    expect(cochranSampleSize(0, COCHRAN_95)).toBe(0);
    expect(cochranSampleSize(-5, COCHRAN_95)).toBe(0);
  });

  it('matches the known ~30% figure for a ~2,900-comment population (SOTU case)', () => {
    const n = cochranSampleSize(2900, COCHRAN_95);
    const pct = n / 2900;
    expect(pct).toBeGreaterThan(0.11);
    expect(pct).toBeLessThan(0.15);
  });

  it('never exceeds the population size', () => {
    const n = cochranSampleSize(50, COCHRAN_95);
    expect(n).toBeLessThanOrEqual(50);
  });

  it('is monotonically non-decreasing as margin of error tightens', () => {
    const loose = cochranSampleSize(1000, { ...COCHRAN_95, marginOfError: 0.1 });
    const tight = cochranSampleSize(1000, { ...COCHRAN_95, marginOfError: 0.03 });
    expect(tight).toBeGreaterThan(loose);
  });
});

describe('resolveTierSampleCount', () => {
  const params = { tier0Percent: 10, tier1Percent: 20, cochran: COCHRAN_95 };

  it('tier 0/1 are simple percentages of the total, capped at the total', () => {
    expect(resolveTierSampleCount(0, 1000, params)).toBe(100);
    expect(resolveTierSampleCount(1, 1000, params)).toBe(200);
    expect(resolveTierSampleCount(0, 5, params)).toBeLessThanOrEqual(5);
  });

  it('tier 2 uses Cochran, not a fixed percentage', () => {
    const tier2 = resolveTierSampleCount(2, 2900, params);
    expect(tier2).toBe(cochranSampleSize(2900, COCHRAN_95));
  });

  it('tier 3 is uncapped -- returns the full population', () => {
    expect(resolveTierSampleCount(3, 50000, params)).toBe(50000);
  });

  it('returns 0 for an empty population regardless of tier', () => {
    expect(resolveTierSampleCount(0, 0, params)).toBe(0);
    expect(resolveTierSampleCount(3, 0, params)).toBe(0);
  });
});

describe('needsAutoExpand', () => {
  it('flags expansion below the floor, not at or above it', () => {
    expect(needsAutoExpand(49, 50)).toBe(true);
    expect(needsAutoExpand(50, 50)).toBe(false);
    expect(needsAutoExpand(51, 50)).toBe(false);
  });
});

function makeComments(count: number): StratifiableComment[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    likeCount: (count - i) * 3, // descending engagement
    publishedAt: new Date(now - i * 3_600_000).toISOString(), // descending recency
  }));
}

describe('stratifiedSampleIndices', () => {
  it('returns all indices when target >= population', () => {
    const comments = makeComments(10);
    const result = stratifiedSampleIndices(comments, 20, 3, 3);
    expect(result.sort((a, b) => a - b)).toEqual(comments.map((c) => c.index));
  });

  it('returns an empty array for zero target or empty input', () => {
    expect(stratifiedSampleIndices(makeComments(10), 0, 3, 3)).toEqual([]);
    expect(stratifiedSampleIndices([], 5, 3, 3)).toEqual([]);
  });

  it('returns exactly the requested count when population is large enough', () => {
    const comments = makeComments(300);
    const result = stratifiedSampleIndices(comments, 90, 3, 3);
    expect(result).toHaveLength(90);
  });

  it('returns unique indices, all within the original population range', () => {
    const comments = makeComments(300);
    const result = stratifiedSampleIndices(comments, 90, 3, 3);
    expect(new Set(result).size).toBe(result.length);
    for (const idx of result) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(300);
    }
  });

  it('draws from both high- and low-engagement strata, not just the top', () => {
    const comments = makeComments(300);
    const result = stratifiedSampleIndices(comments, 90, 3, 3);
    // Highest-engagement third is indices 0-99, lowest is 200-299.
    const hasHighEngagement = result.some((i) => i < 100);
    const hasLowEngagement = result.some((i) => i >= 200);
    expect(hasHighEngagement).toBe(true);
    expect(hasLowEngagement).toBe(true);
  });

  it('is deterministic across repeated calls with identical input', () => {
    const comments = makeComments(150);
    const a = stratifiedSampleIndices(comments, 45, 3, 2);
    const b = stratifiedSampleIndices(comments, 45, 3, 2);
    expect(a).toEqual(b);
  });

  it('handles a population smaller than bucketCount without throwing', () => {
    const comments = makeComments(2);
    const result = stratifiedSampleIndices(comments, 1, 5, 5);
    expect(result.length).toBe(1);
  });
});
