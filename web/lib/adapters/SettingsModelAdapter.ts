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
      if (kind === 'chat') {
        return ['google/gemini-3.1-flash-lite', 'google/gemini-2.0-flash', 'google/gemini-1.5-flash'];
      }
      return ['anthropic/claude-haiku-4.5', 'google/gemini-2.0-flash', 'google/gemini-1.5-flash'];
    }
    return resolveModelCascade(tier, kind);
  }
}