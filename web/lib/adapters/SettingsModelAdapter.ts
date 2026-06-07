import type { UserTier } from '@/lib/types/billing';
import type { IIngestionPort, StreamToken } from '@/lib/ports/IIngestionPort';

export class SettingsModelAdapter implements IIngestionPort {
  async fetch(): Promise<never> {
    throw new Error('Metadata fetch is handled by WorkerIngestionAdapter');
  }

  detectPersona(): never {
    throw new Error('Persona detection is handled by WorkerIngestionAdapter');
  }

  resolveModels(_tier: UserTier, kind: 'analysis' | 'chat'): Promise<string[]> {
    // TEMP OVERRIDE: Force Haiku 4.5 cascade until DB admin panel is built.
    // Revert by restoring: return resolveModelCascade(tier, kind);
    if (kind === 'chat') {
      return Promise.resolve(['anthropic/claude-4.5-haiku', 'anthropic/claude-4.5-haiku']);
    }
    return Promise.resolve(['anthropic/claude-4.5-haiku', 'anthropic/claude-4.5-haiku']);
  }

  signToken(): StreamToken {
    throw new Error('SettingsModelAdapter: signToken not supported');
  }

  buildJobMetadata(): never {
    throw new Error('Metadata building is handled by WorkerIngestionAdapter');
  }
}