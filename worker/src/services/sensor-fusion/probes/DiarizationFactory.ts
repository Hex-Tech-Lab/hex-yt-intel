/**
 * DiarizationFactory — Domain Service / Diarization Cascade (Hexagonal-Lite)
 *
 * Implements DiarizationProviderPort via a resilient multi-provider fallback cascade.
 * Iterates through the configured cascade order (e.g. ['assemblyai', 'deepgram']),
 * attempting execution. Catches 5xx/timeout/API failures, logs to Sentry, and
 * seamlessly falls back to the next provider.
 */

import * as Sentry from '@sentry/cloudflare';
import { DeepgramNova2Adapter } from '../../../adapters/DeepgramNova2Adapter';
import { AssemblyAIAdapter } from '../../../adapters/AssemblyAIAdapter';
import type {
  DiarizationProviderPort,
  DiarizationResult,
} from '../../../ports/DiarizationProviderPort';

export type DiarizationProviderName = 'assemblyai' | 'deepgram';

export interface DiarizationFactoryConfig {
  cascadeOrder?: DiarizationProviderName[];
  deepgramApiKey?: string;
  deepgramTimeoutMs?: number;
  assemblyaiApiKey?: string;
  assemblyaiTimeoutMs?: number;
  customProviders?: Partial<Record<DiarizationProviderName, DiarizationProviderPort>>;
}

export const DEFAULT_DIARIZATION_CASCADE: readonly DiarizationProviderName[] = [
  'assemblyai',
  'deepgram',
];

export class DiarizationCascadeExhaustedError extends Error {
  constructor(message: string, public readonly errors: Array<{ provider: string; error: unknown }>) {
    super(message);
    this.name = 'DiarizationCascadeExhaustedError';
  }
}

export class DiarizationFactory implements DiarizationProviderPort {
  private readonly providers: Map<DiarizationProviderName, DiarizationProviderPort> = new Map();
  private readonly cascadeOrder: DiarizationProviderName[];

  constructor(config: DiarizationFactoryConfig) {
    this.cascadeOrder =
      config.cascadeOrder && config.cascadeOrder.length > 0
        ? config.cascadeOrder
        : [...DEFAULT_DIARIZATION_CASCADE];

    // Wire AssemblyAI
    if (config.customProviders?.assemblyai) {
      this.providers.set('assemblyai', config.customProviders.assemblyai);
    } else if (config.assemblyaiApiKey && config.assemblyaiApiKey.trim() !== '') {
      this.providers.set(
        'assemblyai',
        new AssemblyAIAdapter({
          apiKey: config.assemblyaiApiKey,
          timeoutMs: config.assemblyaiTimeoutMs,
        }),
      );
    }

    // Wire Deepgram
    if (config.customProviders?.deepgram) {
      this.providers.set('deepgram', config.customProviders.deepgram);
    } else if (config.deepgramApiKey && config.deepgramApiKey.trim() !== '') {
      this.providers.set(
        'deepgram',
        new DeepgramNova2Adapter({
          apiKey: config.deepgramApiKey,
          timeoutMs: config.deepgramTimeoutMs,
        }),
      );
    }
  }

  getCascadeOrder(): DiarizationProviderName[] {
    return [...this.cascadeOrder];
  }

  getProvider(name: DiarizationProviderName): DiarizationProviderPort | undefined {
    return this.providers.get(name);
  }

  /**
   * Iterates through the cascade order, attempting execution on each provider.
   * If a provider fails or times out, catches the error, logs to Sentry,
   * and falls back to the next provider.
   */
  async diarizeAudioUrl(audioUrl: string, videoId: string): Promise<DiarizationResult> {
    const attemptedErrors: Array<{ provider: string; error: unknown }> = [];

    for (const providerName of this.cascadeOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        console.warn(`[DiarizationFactory] Provider "${providerName}" has no credentials or adapter registered, skipping.`);
        continue;
      }

      try {
        const result = await provider.diarizeAudioUrl(audioUrl, videoId);
        return result;
      } catch (providerError: unknown) {
        attemptedErrors.push({ provider: providerName, error: providerError });

        Sentry.captureException(providerError, {
          tags: {
            subsystem: 'sensor-fusion',
            component: 'DiarizationFactory',
            failedProvider: providerName,
            videoId,
          },
          extra: {
            cascadeOrder: this.cascadeOrder,
            audioUrl,
            errorDetails: providerError instanceof Error ? providerError.message : String(providerError),
          },
        });

        console.error(`[DiarizationFactory] Provider "${providerName}" failed, evaluating cascade fallback:`, providerError);
      }
    }

    const exhaustedError = new DiarizationCascadeExhaustedError(
      `All diarization cascade providers failed for video ${videoId} ([${this.cascadeOrder.join(' -> ')}])`,
      attemptedErrors,
    );

    Sentry.captureException(exhaustedError, {
      tags: {
        subsystem: 'sensor-fusion',
        component: 'DiarizationFactory',
        outcome: 'exhausted',
        videoId,
      },
    });

    throw exhaustedError;
  }
}
