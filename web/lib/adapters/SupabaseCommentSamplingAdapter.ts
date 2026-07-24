import { SupabaseSettingsAdapter } from './SupabaseSettingsAdapter';
import {
  resolveTierSampleCount,
  needsAutoExpand,
  type SamplingTier,
  type CochranParams,
  type TierSampleParams,
} from '@/lib/services/comment-sampling';
import type { CommentSamplingPort, SamplePlan, CreditEstimate } from '@/lib/ports/CommentSamplingPort';

// Must match the registry's seeded defaults (20260724130000_comments_sampling_engine.sql)
// -- used only if the registry is genuinely unreachable, never as the primary source.
const SAMPLING_FALLBACK = {
  'comments.sampling.tier0Percent': 10,
  'comments.sampling.tier1Percent': 20,
  'comments.sampling.minSignalCount': 50,
  'comments.cochran.zScore': 1.96,
  'comments.cochran.marginOfError': 0.05,
  'comments.cochran.pEstimate': 0.5,
} as const;

const CREDIT_FALLBACK = {
  'comments.credit.costPerCommentUsd': 0.0005,
  'comments.credit.estimateParamsVersion': 1,
  'comments.credit.creditsPerUsd': 100,
} as const;

/**
 * Registry-aware wrapper around the pure functions in
 * web/lib/services/comment-sampling.ts (Phase 0). Those functions stay
 * DB-free for testability; this adapter is the boundary that resolves their
 * parameters from the Settings Registry rather than the caller hardcoding
 * them, per this project's no-hardcoded-magic-numbers convention.
 */
export class SupabaseCommentSamplingAdapter implements CommentSamplingPort {
  async planSample(params: { tier: SamplingTier; totalCommentCount: number }): Promise<SamplePlan> {
    const registry = await SupabaseSettingsAdapter.getRegistrySettings(
      Object.keys(SAMPLING_FALLBACK),
      SAMPLING_FALLBACK
    );

    const cochran: CochranParams = {
      zScore: Number(registry['comments.cochran.zScore']) || SAMPLING_FALLBACK['comments.cochran.zScore'],
      marginOfError: Number(registry['comments.cochran.marginOfError']) || SAMPLING_FALLBACK['comments.cochran.marginOfError'],
      pEstimate: Number(registry['comments.cochran.pEstimate']) || SAMPLING_FALLBACK['comments.cochran.pEstimate'],
    };
    const tierParams: TierSampleParams = {
      tier0Percent: Number(registry['comments.sampling.tier0Percent']) || SAMPLING_FALLBACK['comments.sampling.tier0Percent'],
      tier1Percent: Number(registry['comments.sampling.tier1Percent']) || SAMPLING_FALLBACK['comments.sampling.tier1Percent'],
      cochran,
    };
    const minSignalCount = Number(registry['comments.sampling.minSignalCount']) || SAMPLING_FALLBACK['comments.sampling.minSignalCount'];

    let effectiveTier = params.tier;
    let targetSampleCount = resolveTierSampleCount(effectiveTier, params.totalCommentCount, tierParams);
    let autoExpanded = false;

    // Tier 0 -> Tier 1 auto-expand: only tier 0 escalates (tier 1's own
    // shortfall is a real "not enough comments exist" case, not something
    // more sampling percentage would fix -- there's no tier above 1 to
    // auto-expand to short of jumping straight to the very different Tier 2
    // statistical basis, which is a deliberate tier choice, not an escalation).
    if (effectiveTier === 0 && needsAutoExpand(targetSampleCount, minSignalCount)) {
      effectiveTier = 1;
      targetSampleCount = resolveTierSampleCount(1, params.totalCommentCount, tierParams);
      autoExpanded = true;
    }

    return {
      tier: effectiveTier,
      totalCommentCount: params.totalCommentCount,
      targetSampleCount,
      autoExpanded,
    };
  }

  async estimateCreditCost(params: { totalCommentCount: number }): Promise<CreditEstimate> {
    const registry = await SupabaseSettingsAdapter.getRegistrySettings(
      Object.keys(CREDIT_FALLBACK),
      CREDIT_FALLBACK
    );
    const costPerCommentUsd = Number(registry['comments.credit.costPerCommentUsd']) || CREDIT_FALLBACK['comments.credit.costPerCommentUsd'];
    const estimateParamsVersion = Number(registry['comments.credit.estimateParamsVersion']) || CREDIT_FALLBACK['comments.credit.estimateParamsVersion'];
    // No existing USD<->credit conversion precedent elsewhere in the codebase
    // (verified by grep before adding this) -- this ratio is new and
    // registry-driven like everything else here, not an established constant.
    const creditsPerUsd = Number(registry['comments.credit.creditsPerUsd']) || CREDIT_FALLBACK['comments.credit.creditsPerUsd'];

    const estimatedCostUsd = params.totalCommentCount * costPerCommentUsd;
    return {
      estimatedCommentCount: params.totalCommentCount,
      estimatedCredits: Math.ceil(estimatedCostUsd * creditsPerUsd),
      estimatedCostUsd,
      estimateParamsVersion,
    };
  }
}
