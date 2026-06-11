import type { UserTier } from '@/lib/types/billing';
import type { ModelResolutionPort } from '@/lib/ports';
import { resolveModelCascade } from '@/lib/services/settings';
import { CHAT_CASCADE, ANALYSIS_CASCADE } from '../config/cascade';

export class SettingsModelAdapter implements ModelResolutionPort {
  private readonly commercialTrialMode: boolean;

  constructor(config?: { commercialTrialMode?: boolean }) {
    // See docs: SettingsModelAdapter architecture for trial mode configuration.
    const envFlag = process.env.COMMERCIAL_TRIAL_MODE;
    this.commercialTrialMode = config?.commercialTrialMode ?? (envFlag !== undefined ? envFlag === 'true' : true);
  }

  /**
   * Resolves the model list for ingestion requests.
   * @param tier - User tier.
   * @param kind - Request kind: 'analysis' or 'chat'.
   * @returns Promise resolving to model array (resolves via resolveModelCascade unless in trial mode).
   */
  async resolveModels(tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]> {
    if (this.commercialTrialMode) {
      if (kind === 'chat') {
        return CHAT_CASCADE.map((c) => c.model);
      }
      return ANALYSIS_CASCADE.map((c) => c.model);
    }
    return resolveModelCascade(tier, kind);
  }
}