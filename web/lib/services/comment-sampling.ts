/**
 * Comments multi-stage sampling engine — Phase 0 (statistics only, no I/O).
 *
 * Design ref: docs/specs/COMMENTS_SAMPLING_ENGINE_PLAN_2026-07-24.md.
 * Tier 0/1: fixed percentages (registry-driven). Tier 2: Cochran's formula
 * with finite-population correction, so the sample size is derived from a
 * real confidence/margin-of-error target rather than an arbitrary percentage.
 * Tier 3: uncapped (see the plan doc for the credit-metering side of that).
 *
 * All numeric knobs are function parameters, not constants in this file --
 * callers resolve them from the Settings Registry (SupabaseSettingsAdapter,
 * setting_definitions/setting_values) per this project's
 * no-hardcoded-magic-numbers convention. Kept DB/provider-free so it's
 * unit-testable the same way web/lib/prompts/executive-digest.ts is.
 */

export interface CochranParams {
  /** z-score for the target confidence level (e.g. 1.96 for 95% CI). */
  zScore: number;
  /** Acceptable margin of error, as a fraction (e.g. 0.05 for ±5%). */
  marginOfError: number;
  /** Estimated population proportion, as a fraction (0.5 maximizes required
   *  sample size -- the conservative default when the true proportion is
   *  unknown, which is always true here). */
  pEstimate: number;
}

/**
 * Cochran's sample-size formula with finite-population correction.
 * n0 = z²·p·(1-p) / e², then n = n0 / (1 + (n0-1)/N).
 * Returns an integer sample size, capped at the population size.
 */
export function cochranSampleSize(populationSize: number, params: CochranParams): number {
  if (populationSize <= 0) return 0;
  const { zScore, marginOfError, pEstimate } = params;
  const n0 = (zScore ** 2 * pEstimate * (1 - pEstimate)) / marginOfError ** 2;
  const n = n0 / (1 + (n0 - 1) / populationSize);
  return Math.min(populationSize, Math.max(1, Math.ceil(n)));
}

export type SamplingTier = 0 | 1 | 2 | 3;

export interface TierSampleParams {
  /** Tier 0 sample percent, 0-100 (e.g. 10). */
  tier0Percent: number;
  /** Tier 1 sample percent, 0-100 (e.g. 20). */
  tier1Percent: number;
  cochran: CochranParams;
}

/** Resolves how many comments a given tier should target, out of a known total. */
export function resolveTierSampleCount(
  tier: SamplingTier,
  totalCommentCount: number,
  params: TierSampleParams
): number {
  if (totalCommentCount <= 0) return 0;
  switch (tier) {
    case 0:
      return Math.min(totalCommentCount, Math.ceil(totalCommentCount * (params.tier0Percent / 100)));
    case 1:
      return Math.min(totalCommentCount, Math.ceil(totalCommentCount * (params.tier1Percent / 100)));
    case 2:
      return cochranSampleSize(totalCommentCount, params.cochran);
    case 3:
      return totalCommentCount;
  }
}

/**
 * Auto-expand trigger (Tier 0 -> Tier 1): a minimum absolute sample-size
 * floor, chosen over a standard-error or theme-entropy check to avoid a
 * circular dependency on the batched classifier (Phase 5) just to decide
 * whether to expand.
 */
export function needsAutoExpand(sampledCount: number, minSignalCount: number): boolean {
  return sampledCount < minSignalCount;
}

export interface StratifiableComment {
  /** Index into the caller's original array -- preserved through bucketing. */
  index: number;
  likeCount: number;
  /** ISO 8601 timestamp. */
  publishedAt: string;
}

interface Stratum {
  members: StratifiableComment[];
}

/** Splits a like-count-sorted array into `bucketCount` contiguous, roughly-equal-size buckets. */
function bucketize(items: StratifiableComment[], bucketCount: number): StratifiableComment[][] {
  if (bucketCount <= 1 || items.length === 0) return [items];
  const buckets: StratifiableComment[][] = [];
  const baseSize = Math.floor(items.length / bucketCount);
  const remainder = items.length % bucketCount;
  let cursor = 0;
  for (let i = 0; i < bucketCount; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    if (size === 0) continue;
    buckets.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return buckets;
}

/**
 * Two-dimensional stratified sample: like-count buckets x recency buckets.
 * Chosen over a single dimension because comment signal on YouTube clusters
 * on both engagement and posting time -- a like-only strata over-samples
 * viral early comments and under-samples steady-state reactions, and vice
 * versa for recency-only.
 *
 * Allocates the target count proportionally to each non-empty stratum's
 * share of the population, then picks evenly-spaced (systematic) members
 * within each stratum -- deterministic and reproducible, no RNG dependency.
 *
 * Returns original-array indices, not comment objects.
 */
export function stratifiedSampleIndices(
  comments: StratifiableComment[],
  targetCount: number,
  likeBucketCount: number,
  recencyBucketCount: number
): number[] {
  const total = comments.length;
  if (total === 0 || targetCount <= 0) return [];
  if (targetCount >= total) return comments.map((comment) => comment.index);

  const byLikesDesc = [...comments].sort((a, b) => b.likeCount - a.likeCount);
  const likeBuckets = bucketize(byLikesDesc, likeBucketCount);

  const strata: Stratum[] = [];
  for (const likeBucket of likeBuckets) {
    const byRecencyDesc = [...likeBucket].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    for (const recencyBucket of bucketize(byRecencyDesc, recencyBucketCount)) {
      if (recencyBucket.length > 0) strata.push({ members: recencyBucket });
    }
  }

  // Proportional allocation with largest-remainder rounding so allocations sum to targetCount exactly.
  const rawAllocations = strata.map((stratum) => (stratum.members.length / total) * targetCount);
  const floored = rawAllocations.map(Math.floor);
  let allocated = floored.reduce((sum, count) => sum + count, 0);
  const remainders = rawAllocations
    .map((raw, i) => ({ i, frac: raw - floored[i]! }))
    .sort((a, b) => b.frac - a.frac);
  let remainderIdx = 0;
  while (allocated < targetCount && remainderIdx < remainders.length) {
    const entry = remainders[remainderIdx]!;
    if (floored[entry.i]! < strata[entry.i]!.members.length) {
      floored[entry.i]! += 1;
      allocated += 1;
    }
    remainderIdx += 1;
  }

  const result: number[] = [];
  strata.forEach((stratum, i) => {
    const take = Math.min(floored[i]!, stratum.members.length);
    if (take <= 0) return;
    if (take >= stratum.members.length) {
      result.push(...stratum.members.map((member) => member.index));
      return;
    }
    // Systematic sampling: evenly-spaced picks across the stratum.
    const step = stratum.members.length / take;
    for (let k = 0; k < take; k++) {
      const pos = Math.min(stratum.members.length - 1, Math.floor(k * step));
      result.push(stratum.members[pos]!.index);
    }
  });

  return result;
}
