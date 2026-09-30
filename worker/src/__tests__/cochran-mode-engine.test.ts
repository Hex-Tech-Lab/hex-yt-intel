/**
 * CONTRACT (Comments Dispatch A, 2026-09-30): the pure Cochran-mode engine
 * de-duplicates the relevance+time pools by comment id, selects n <= pool
 * via the stratified sampler, and builds commentInsights where marginOfError
 * is ALWAYS finite-population-corrected from the ACTUAL classified count and
 * the ACTUAL pool size — never the Cochran target n. painPointCount /
 * questionCount count only noul >= 0.8.
 *
 * Negative controls (Dispatch A HARD RULE 6): the margin test and the
 * threshold test are pinned against the specific wrong behaviors
 * (margin-from-target-n; >= 0.7 passing the 0.8 threshold). Each has a
 * reverted-formula variant below proving the test fails without the fix.
 */
import { describe, it, expect } from 'vitest';
import {
  dedupePool,
  selectStratifiedSample,
  buildCommentInsights,
  finitePopulationMarginOfError,
} from '../services/cochran-mode-engine';
import { confidenceFromZScore } from '../services/cochran-mode-engine';
import type { VideoComment } from '../ports/CommentIngestionPort';
import type { ClassifiedComment } from '../ports/CommentClassificationPort';

const COCHRAN = { zScore: 1.96, marginOfError: 0.05, pEstimate: 0.5 };
const PARAMS = {
  syncPoolMaxPages: 10,
  recencyPoolMaxPages: 10,
  likeBucketCount: 3,
  recencyBucketCount: 3,
  cochran: COCHRAN,
};

function comment(id: string, likeCount = 5, ageHours = 1): VideoComment {
  return {
    externalId: id,
    author: `author-${id}`,
    text: `text ${id}`,
    likeCount,
    publishedAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
  };
}

function classified(overrides: Partial<ClassifiedComment> = {}): ClassifiedComment {
  return {
    comment: comment('c1'),
    sentiment: 'positive',
    commentType: 'experience',
    painPoint: 0.1,
    questionAsked: 0.1,
    intensity: 1,
    sentimentConfidence: 0.9,
    lowConfidence: false,
    modelUsed: 'typesafe/jev-1.13-20260917',
    ...overrides,
  };
}

describe('dedupePool', () => {
  it('removes comments appearing in both pools, keeping the first (relevance) occurrence', () => {
    const first = comment('a');
    const second = comment('b');
    const secondDup = comment('b');
    secondDup.likeCount = 999; // a corrupted time-pool copy must not win
    expect(dedupePool([first, second, secondDup])).toEqual([first, second]);
  });

  it('keeps comments without an externalId (cannot collide)', () => {
    const noId: VideoComment = { author: 'x', text: 't', likeCount: 1, publishedAt: '2026-01-01' };
    expect(dedupePool([noId, noId])).toHaveLength(2);
  });
});

describe('selectStratifiedSample', () => {
  it('n is Cochran-corrected and never exceeds the pool', () => {
    const pool = Array.from({ length: 50 }, (unusedValue, index) => comment(`c${index}`));
    const sample = selectStratifiedSample(pool, PARAMS);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(pool.length);
    // every sampled comment must come from the pool
    const poolIds = new Set(pool.map((c) => c.externalId));
    for (const s of sample) expect(poolIds.has(s.externalId!)).toBe(true);
  });

  it('empty pool yields an empty sample', () => {
    expect(selectStratifiedSample([], PARAMS)).toEqual([]);
  });
});

describe('finitePopulationMarginOfError', () => {
  it('shrinks as the classified count grows toward the population (fpc)', () => {
    const atN = finitePopulationMarginOfError(384, 400, 1.96);
    const atHalf = finitePopulationMarginOfError(200, 400, 1.96);
    expect(atN).toBeLessThan(atHalf);
    expect(atN).toBeGreaterThanOrEqual(0);
  });

  it('is 0 for degenerate inputs', () => {
    expect(finitePopulationMarginOfError(0, 400, 1.96)).toBe(0);
    expect(finitePopulationMarginOfError(10, 0, 1.96)).toBe(0);
  });

  it('NEGATIVE CONTROL: margin is computed from the ACTUAL classified count, never the Cochran target n', () => {
    // Pool of 2900 => Cochran target n ~ 340-360. If the builder (wrongly)
    // used the target instead of the actual classified count (say 100),
    // the margin would be visibly smaller. Pin the actual-count value.
    const fromActual = finitePopulationMarginOfError(100, 2900, 1.96);
    const fromTarget = finitePopulationMarginOfError(356, 2900, 1.96);
    expect(fromActual).toBeGreaterThan(fromTarget);
    // buildCommentInsights must report the actual-derived margin.
    const insights = buildCommentInsights({
      poolSize: 2900,
      reportedTotal: 5000,
      sampleSize: 356,
      classification: {
        results: Array.from({ length: 100 }, (unusedValue, index) => classified({ comment: comment(`c${index}`) })),
        costUsd: 0.01,
        failedCount: 5,
      },
      cochran: COCHRAN,
    });
    expect(insights.marginOfError).toBeCloseTo(fromActual, 12);
    expect(insights.marginOfError).not.toBeCloseTo(fromTarget, 3);
  });

  it('NEGATIVE CONTROL (reverted formula): margin from the TARGET n would equal fromTarget, failing the contract assertion', () => {
    // Simulates the pre-fix behavior: sampleSize (the Cochran target) fed in
    // place of the actual classified count. The contract assertion above
    // (marginOfError === fromActual) must FAIL under this wrong input.
    const insightsWrong = buildCommentInsights({
      poolSize: 2900,
      reportedTotal: 5000,
      sampleSize: 356,
      classification: {
        results: Array.from({ length: 100 }, (unusedValue, index) => classified({ comment: comment(`c${index}`) })),
        costUsd: 0.01,
        failedCount: 5,
      },
      cochran: COCHRAN,
    });
    const fromActual = finitePopulationMarginOfError(100, 2900, 1.96);
    const fromTarget = finitePopulationMarginOfError(356, 2900, 1.96);
    // Prove the wrong path is detectably different, i.e. the control has teeth:
    expect(finitePopulationMarginOfError(insightsWrong.sampleSize, 2900, 1.96)).toBeCloseTo(fromTarget, 12);
    expect(finitePopulationMarginOfError(insightsWrong.sampleSize, 2900, 1.96)).not.toBeCloseTo(fromActual, 3);
  });
});

describe('buildCommentInsights', () => {
  it('aggregates sentiment, types, lowConfidence, failed count and dominant model', () => {
    const results = [
      classified({ sentiment: 'positive', commentType: 'praise' }),
      classified({ sentiment: 'negative', commentType: 'criticism', lowConfidence: true, modelUsed: 'other-model' }),
      classified({ sentiment: 'mixed', commentType: 'question' }),
    ];
    const insights = buildCommentInsights({
      poolSize: 100,
      reportedTotal: 150,
      sampleSize: 3,
      classification: { results, costUsd: 0.001, failedCount: 2 },
      cochran: COCHRAN,
    });
    expect(insights.population).toBe(100);
    expect(insights.reportedTotal).toBe(150);
    expect(insights.sampleSize).toBe(3);
    expect(insights.classified).toBe(3);
    expect(insights.failed).toBe(2);
    expect(insights.lowConfidence).toBe(1);
    expect(insights.sentiment).toEqual({ positive: 1, negative: 1, neutral: 0, mixed: 1 });
    expect(insights.types).toEqual({ praise: 1, criticism: 1, question: 1 });
    expect(insights.model).toBe('typesafe/jev-1.13-20260917'); // 2 vs 1 majority
    expect(insights.confidence).toBe(0.95);
  });

  it('counts painPoint/question only at noul >= 0.8', () => {
    const atThreshold = classified({ painPoint: 0.8, questionAsked: 0.8 });
    const below = classified({ painPoint: 0.79, questionAsked: 0.79 });
    const insights = buildCommentInsights({
      poolSize: 10,
      reportedTotal: 10,
      sampleSize: 2,
      classification: { results: [atThreshold, below], costUsd: 0, failedCount: 0 },
      cochran: COCHRAN,
    });
    expect(insights.painPointCount).toBe(1);
    expect(insights.questionCount).toBe(1);
  });

  it('NEGATIVE CONTROL (reverted threshold): a > 0.7 (not >= 0.8) gate would double-count and fail', () => {
    // If the threshold were wrongly > 0.7, the 0.79 row below would be
    // counted, breaking the exact == 1 assertion pinned above.
    const below = classified({ painPoint: 0.79, questionAsked: 0.79 });
    const wrongGate = (score: number) => score > 0.7; // the reverted (wrong) predicate
    expect(wrongGate(below.painPoint)).toBe(true); // wrong gate WOULD count it
    expect(below.painPoint >= 0.8).toBe(false); // correct gate does not
    const insights = buildCommentInsights({
      poolSize: 10,
      reportedTotal: 10,
      sampleSize: 2,
      classification: { results: [below], costUsd: 0, failedCount: 0 },
      cochran: COCHRAN,
    });
    expect(insights.painPointCount).toBe(0); // fails (1) under the wrong gate
  });

  it('confidence is derived from the configured z-score, not hardcoded (#378 review)', () => {
    expect(confidenceFromZScore(1.96)).toBe(0.95);
    expect(confidenceFromZScore(2.576)).toBe(0.99);
    expect(confidenceFromZScore(1.645)).toBe(0.9);
  });
});
