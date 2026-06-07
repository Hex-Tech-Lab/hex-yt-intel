import type { UserTier } from '@/lib/types/billing';
import type { IIngestionPort, StreamToken } from '@/lib/ports/IIngestionPort';

export class SettingsModelAdapter implements IIngestionPort {
  async fetch(): Promise<never> {
    throw new Error('Metadata fetch is handled by WorkerIngestionAdapter');
  }

  detectPersona(): never {
    throw new Error('Persona detection is handled by WorkerIngestionAdapter');
  }

  /**
   * Resolves the model list for ingestion requests.
   * @param _tier - User tier (unused in this adapter; WorkerIngestionAdapter handles tier logic).
   * @param _kind - Request kind: 'analysis' or 'chat' (unused; returns single default model).
   * @returns Promise resolving to an array containing the default Haiku model.
   */
  resolveModels(_tier: UserTier, _kind: 'analysis' | 'chat'): Promise<string[]> {
    return Promise.resolve(['anthropic/claude-haiku-4.5']);
  }

  signToken(): StreamToken {
    throw new Error('SettingsModelAdapter: signToken not supported');
  }

  buildJobMetadata(): never {
    throw new Error('Metadata building is handled by WorkerIngestionAdapter');
  }
}