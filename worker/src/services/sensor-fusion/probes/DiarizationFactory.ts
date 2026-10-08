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
import { redactMediaUrl, redactUrlsInText } from '../diarization-metrics';
import type {
  DiarizationProviderPort,
  DiarizationResult,
} from '../../../ports/DiarizationProviderPort';

export type DiarizationProviderName = 'assemblyai' | 'deepgram';

export const DEFAULT_TOTAL_CASCADE_TIMEOUT_MS = 18000;

export interface DiarizationFactoryConfig {
  cascadeOrder?: DiarizationProviderName[];
  totalCascadeTimeoutMs?: number;
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
  private readonly totalCascadeTimeoutMs: number;

  constructor(config: DiarizationFactoryConfig) {
    this.cascadeOrder =
      config.cascadeOrder && config.cascadeOrder.length > 0
        ? [...config.cascadeOrder]
        : [...DEFAULT_DIARIZATION_CASCADE];
    this.totalCascadeTimeoutMs =
      config.totalCascadeTimeoutMs && config.totalCascadeTimeoutMs > 0
        ? config.totalCascadeTimeoutMs
        : DEFAULT_TOTAL_CASCADE_TIMEOUT_MS;

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
   * calculates remaining time against totalCascadeTimeoutMs, and falls back to the next provider.
   * If remainingTime <= 0, immediately aborts without attempting subsequent providers.
   */
  async diarizeAudioUrl(
    audioUrl: string,
    videoId: string,
    options?: { timeoutMs?: number },
  ): Promise<DiarizationResult> {
    const cascadeStartTime = Date.now();
    const effectiveCascadeTimeoutMs =
      options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : this.totalCascadeTimeoutMs;

    const attemptedErrors: Array<{ provider: string; error: unknown }> = [];

    for (const providerName of this.cascadeOrder) {
      const elapsedMs = Date.now() - cascadeStartTime;
      const remainingTimeMs = effectiveCascadeTimeoutMs - elapsedMs;

      if (remainingTimeMs <= 0) {
        console.warn(
          `[DiarizationFactory] Total cascade timeout budget exhausted (${effectiveCascadeTimeoutMs}ms). Skipping remaining provider "${providerName}".`,
        );
        attemptedErrors.push({
          provider: providerName,
          error: new Error(`Cascade timeout budget exhausted before provider execution (${elapsedMs}ms elapsed)`),
        });
        break;
      }

      const provider = this.providers.get(providerName);
      if (!provider) {
        console.warn(`[DiarizationFactory] Provider "${providerName}" has no credentials or adapter registered, skipping.`);
        continue;
      }

      try {
        const result = await provider.diarizeAudioUrl(audioUrl, videoId, { timeoutMs: remainingTimeMs });
        return result;
      } catch (providerError: unknown) {
        attemptedErrors.push({ provider: providerName, error: providerError });

        // Provider error text may echo the submitted (signed) media URL —
        // sanitize before capture; never attach the raw exception object.
        const sanitizedMessage = redactUrlsInText(
          providerError instanceof Error ? providerError.message : String(providerError),
        );
        const sanitizedError = new Error(sanitizedMessage);

        Sentry.captureException(sanitizedError, {
          tags: {
            subsystem: 'sensor-fusion',
            component: 'DiarizationFactory',
            failedProvider: providerName,
            videoId,
          },
          extra: {
            cascadeOrder: this.cascadeOrder,
            audioUrl: redactMediaUrl(audioUrl),
            remainingTimeMs,
          },
        });

        console.error(
          `[DiarizationFactory] Provider "${providerName}" failed, evaluating cascade fallback:`,
          sanitizedError,
        );
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
