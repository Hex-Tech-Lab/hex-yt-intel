/**
 * CochranModeEngine — pure pool→sample→insights builder (Comments Dispatch A,
 * 2026-09-30). No I/O: takes the de-duplicated comment pool + sampling params,
 * returns the stratified sample selection and the commentInsights payload
 * shape the persist route writes into analysis_payload. Unit-testable
 * directly (worker/src/__tests__/cochran-mode-engine.test.ts).
 *
 * marginOfError is ALWAYS computed from the ACTUAL classified count and the
 * actual pool size (finite-population corrected) — never the target n. That
 * is the contract negative control in the test suite.
 */

import { cochranSampleSize, stratifiedSampleIndices, type CochranParams } from '@/lib/services/comment-sampling';
import type { VideoComment } from '../ports/CommentIngestionPort';
import type { ClassifiedComment } from '../ports/CommentClassificationPort';

export interface CochranSamplingParams {
  syncPoolMaxPages: number;
  recencyPoolMaxPages: number;
  likeBucketCount: number;
  recencyBucketCount: number;
  cochran: CochranParams;
}

export interface CommentInsights {
  population: number;
  reportedTotal: number;
  sampleSize: number;
  classified: number;
  failed: number;
  lowConfidence: number;
  marginOfError: number;
  confidence: number;
  /** The margin covers the de-duplicated sampled POOL (relevance + newest
   *  pages), not every comment on the video (#378 review). */
  marginScope: 'sampled_pool';
  sentiment: { positive: number; negative: number; neutral: number; mixed: number };
  types: Record<string, number>;
  painPointCount: number;
  questionCount: number;
  costUsd: number;
  model: string;
  completedAt: string;
}

/** De-duplicates the combined relevance+time pools by comment id, keeping the first occurrence. Comments without an externalId are kept (can't collide). */
export function dedupePool(comments: VideoComment[]): VideoComment[] {
  const seen = new Set<string>();
  const result: VideoComment[] = [];
  for (const comment of comments) {
    if (comment.externalId === undefined) {
      result.push(comment);
      continue;
    }
    if (seen.has(comment.externalId)) continue;
    seen.add(comment.externalId);
    result.push(comment);
  }
  return result;
}

/** Picks n comments from the pool via the existing stratified sampler. */
export function selectStratifiedSample(
  pool: VideoComment[],
  params: CochranSamplingParams
): VideoComment[] {
  if (pool.length === 0) return [];
  const sampleSize = cochranSampleSize(pool.length, params.cochran);
  const indices = stratifiedSampleIndices(
    pool.map((comment, index) => ({ index, likeCount: comment.likeCount, publishedAt: comment.publishedAt })),
    sampleSize,
    params.likeBucketCount,
    params.recencyBucketCount
  );
  return indices.map((index) => pool[index]!).filter((comment): comment is VideoComment => comment !== undefined);
}

/**
 * Cochran margin of error on the OBSERVED sample, finite-population
 * corrected: e = z·sqrt(p(1-p)/n)·sqrt((N-n)/(N-1)). Uses p=0.5
 * (max-variance, conservative) so the reported margin is an upper bound.
 */
export function finitePopulationMarginOfError(
  classifiedCount: number,
  populationSize: number,
  zScore: number
): number {
  if (classifiedCount <= 0 || populationSize <= 0) return 0;
  const observed = Math.min(classifiedCount, populationSize);
  const proportion = 0.5;
  const base = Math.sqrt((proportion * (1 - proportion)) / observed);
  const fpc = populationSize > 1 ? Math.sqrt((populationSize - observed) / (populationSize - 1)) : 0;
  return zScore * base * fpc;
}

export interface BuildInsightsParams {
  poolSize: number;
  reportedTotal: number;
  sampleSize: number;
  classification: { results: ClassifiedComment[]; costUsd: number; failedCount: number };
  cochran: CochranParams;
}

const PAIN_POINT_THRESHOLD = 0.8;
const QUESTION_THRESHOLD = 0.8;

export function buildCommentInsights(params: BuildInsightsParams): CommentInsights {
  const { results, costUsd, failedCount } = params.classification;
  const sentiment = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  const types: Record<string, number> = {};
  let lowConfidence = 0;
  let painPointCount = 0;
  let questionCount = 0;
  const modelCounts = new Map<string, number>();

  for (const result of results) {
    sentiment[result.sentiment] += 1;
    types[result.commentType] = (types[result.commentType] ?? 0) + 1;
    if (result.lowConfidence) lowConfidence += 1;
    if (result.painPoint >= PAIN_POINT_THRESHOLD) painPointCount += 1;
    if (result.questionAsked >= QUESTION_THRESHOLD) questionCount += 1;
    modelCounts.set(result.modelUsed, (modelCounts.get(result.modelUsed) ?? 0) + 1);
  }

  let model = 'unknown';
  let modelMax = 0;
  for (const [candidate, count] of modelCounts) {
    if (count > modelMax) {
      model = candidate;
      modelMax = count;
    }
  }

  return {
    population: params.poolSize,
    reportedTotal: params.reportedTotal,
    sampleSize: params.sampleSize,
    classified: results.length,
    failed: failedCount,
    lowConfidence,
    marginOfError: finitePopulationMarginOfError(results.length, params.poolSize, params.cochran.zScore),
    confidence: confidenceFromZScore(params.cochran.zScore),
    marginScope: 'sampled_pool',
    sentiment,
    types,
    painPointCount,
    questionCount,
    costUsd,
    model,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Two-sided confidence level for a z-score: erf(z / sqrt 2), via
 * Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). z = 1.96 -> 0.95. Rounded to
 * 3 decimals so the stored value reads like the configured level.
 */
export function confidenceFromZScore(zScore: number): number {
  const x = Math.abs(zScore) / Math.SQRT2;
  const term = 1 / (1 + 0.3275911 * x);
  const poly = term * (0.254829592 + term * (-0.284496736 + term * (1.421413741 + term * (-1.453152027 + term * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return Math.round(erf * 1000) / 1000;
}
