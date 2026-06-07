import type { UserTier } from '@/lib/types/billing';
import type { IIngestionPort, StreamToken } from '@/lib/ports/IIngestionPort';

export class SettingsModelAdapter implements IIngestionPort {
  async fetch(): Promise<never> {
    throw new Error('Metadata fetch is handled by WorkerIngestionAdapter');
  }

  detectPersona(): never {
    throw new Error('Persona detection is handled by WorkerIngestionAdapter');
  }

  /** When true, restricts SettingsModelAdapter to Haiku only (commercial trial mode). */
  private static readonly COMMERCIAL_TRIAL_MODE = true;

  /**
   * Resolves the model list for ingestion requests.
   * @param _tier - User tier (unused in this adapter; WorkerIngestionAdapter handles tier logic).
   * @param kind - Request kind: 'analysis' or 'chat'.
   * @returns Promise resolving to model array (Haiku-only in trial mode, cascade otherwise).
   */
  resolveModels(_tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]> {
    if (SettingsModelAdapter.COMMERCIAL_TRIAL_MODE) {
      return Promise.resolve(['anthropic/claude-haiku-4.5']);
    }
    if (kind === 'chat') {
      return Promise.resolve(['anthropic/claude-haiku-4.5']);
    }
    return Promise.resolve(['nvidia/nemotron-3-nano-30b-a3b:free', 'anthropic/claude-haiku-4.5']);
  }

  signToken(): StreamToken {
    throw new Error('SettingsModelAdapter: signToken not supported');
  }

  buildJobMetadata(): never {
    throw new Error('Metadata building is handled by WorkerIngestionAdapter');
  }
}