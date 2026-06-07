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