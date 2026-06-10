import type { UserTier } from '@/lib/types/billing';

/**
 * Handles resolving model cascades for different user subscription tiers.
 */
export interface ModelResolutionPort {
  /**
   * Resolve the ordered model cascade for the given tier and kind.
   */
  resolveModels(tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]>;
}
