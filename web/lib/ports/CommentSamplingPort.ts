import type { SamplingTier } from '@/lib/services/comment-sampling';

/** What a sample plan resolves to before any fetching happens. */
export interface SamplePlan {
  tier: SamplingTier;
  totalCommentCount: number;
  targetSampleCount: number;
  /** True if Tier 0's sample fell below the registry's minSignalCount floor and escalated to Tier 1. */
  autoExpanded: boolean;
}

/** Tier 3 pre-commit estimate, shown to the user before they approve a wallet draw-down. */
export interface CreditEstimate {
  estimatedCommentCount: number;
  estimatedCredits: number;
  estimatedCostUsd: number;
  /** Settings-registry `comments.credit.estimateParamsVersion` this estimate was computed under. */
  estimateParamsVersion: number;
}

/**
 * The sampling-decision slice the comments feature needs: given a known
 * comment-count total, decide how many to actually sample (Tier 0-2) or what
 * Tier 3's uncapped fetch would cost (pre-commit, before the user approves a
 * wallet draw-down). Wraps the pure functions in
 * web/lib/services/comment-sampling.ts with the settings-registry resolution
 * those functions deliberately don't do themselves (kept DB-free for
 * testability) -- this port is the DB-aware boundary around them.
 */
export interface CommentSamplingPort {
  planSample(params: { tier: SamplingTier; totalCommentCount: number }): Promise<SamplePlan>;

  estimateCreditCost(params: { totalCommentCount: number }): Promise<CreditEstimate>;
}
