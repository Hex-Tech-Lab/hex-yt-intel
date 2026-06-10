import type { UserTier } from '@/lib/types/billing';
import type { ModelResolutionPort } from '@/lib/ports';
import { resolveModelCascade } from '@/lib/services/settings';

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
      return ['anthropic/claude-haiku-4.5'];
    }
    return resolveModelCascade(tier, kind);
  }
}