/**
 * DeepgramNova2Adapter — Infrastructure Adapter (Hexagonal-Lite)
 *
 * Implements DiarizationProviderPort targeting the Deepgram Nova-2 pre-recorded
 * audio endpoint with diarization enabled (ADR 039 §1.1, §5.2).
 *
 * Computes native speakerCount, Shannon turnEntropy, and overlapRatio
 * directly over word-level timestamp intervals returned by Nova-2.
 * Enforces a strict fail-closed timeout guard (10 seconds default).
 */

import * as Sentry from '@sentry/cloudflare';

import {
  calculateDiarizationMetrics,
  redactMediaUrl,
  redactUrlsInText,
} from '../services/sensor-fusion/diarization-metrics';

import type {
  DiarizationProviderPort,
  DiarizationResult,
  DiarizationMetrics,
  WordDiarization,
} from '../ports/DiarizationProviderPort';

export interface DeepgramConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  model?: string;
}

export const DEEPGRAM_DEFAULT_TIMEOUT_MS = 10000;
export const DEEPGRAM_DEFAULT_MODEL = 'nova-2';
export const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

interface DeepgramWordResponse {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

interface DeepgramApiResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: DeepgramWordResponse[];
      }>;
    }>;
  };
  metadata?: {
    duration?: number;
  };
}

/** Error thrown by the Deepgram Nova-2 diarization adapter on HTTP, API, or timeout failures. */
export class DeepgramDiarizationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isTimeout?: boolean,
  ) {
    super(message);
    this.name = 'DeepgramDiarizationError';
  }
}

/** DiarizationProviderPort adapter targeting the Deepgram Nova-2 pre-recorded endpoint. */
export class DeepgramNova2Adapter implements DiarizationProviderPort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(config: DeepgramConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('[DeepgramNova2Adapter] Deepgram API key is required and cannot be empty.');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl || DEEPGRAM_API_URL;
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEEPGRAM_DEFAULT_TIMEOUT_MS;
    this.model = config.model || DEEPGRAM_DEFAULT_MODEL;
  }

  /**
   * Sends the audio URL to Deepgram's pre-recorded endpoint with diarization
   * enabled and computes metrics over the returned word timings (fail-closed
   * on timeout).
   */
  async diarizeAudioUrl(
    audioUrl: string,
    videoId: string,
    options?: { timeoutMs?: number },
  ): Promise<DiarizationResult> {
    const startTime = Date.now();
    const effectiveTimeoutMs =
      options?.timeoutMs && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, this.timeoutMs)
        : this.timeoutMs;
    const url = new URL(this.baseUrl);
    url.searchParams.set('model', this.model);
    url.searchParams.set('diarize', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('utterances', 'false');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ url: audioUrl }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // If the abort fired while reading the error body, classify as a
        // timeout instead of masking it with the HTTP status.
        if (controller.signal.aborted) {
          throw new DeepgramDiarizationError(
            `Deepgram diarization timed out after ${effectiveTimeoutMs}ms (fail-closed)`,
            408,
            true,
          );
        }
        const errorText = await response.text().catch(() => '');
        const error = new DeepgramDiarizationError(
          `Deepgram API HTTP ${response.status}: ${redactUrlsInText(errorText || response.statusText)}`,
          response.status,
          false,
        );
        Sentry.captureException(error, {
          tags: { subsystem: 'sensor-fusion', provider: 'deepgram', videoId },
          extra: { status: response.status, audioUrl: redactMediaUrl(audioUrl) },
        });
        throw error;
      }

      const data = (await response.json()) as DeepgramApiResponse;
      const rawWords = data.results?.channels?.[0]?.alternatives?.[0]?.words || [];

      const words: WordDiarization[] = rawWords.map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        speaker: typeof w.speaker === 'number' ? w.speaker : 0,
      }));

      const metrics = DeepgramNova2Adapter.calculateMetrics(words);
      const latencyMs = Date.now() - startTime;

      return {
        videoId,
        metrics,
        words,
        latencyMs,
      };
    } catch (err: unknown) {
      if (err instanceof DeepgramDiarizationError) {
        throw err;
      }

      const isAbort = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      const wrappedError = new DeepgramDiarizationError(
        isAbort
          ? `Deepgram diarization timed out after ${effectiveTimeoutMs}ms (fail-closed)`
          : `Deepgram diarization request failed: ${redactUrlsInText((err as Error)?.message || String(err))}`,
        isAbort ? 408 : 500,
        isAbort,
      );

      Sentry.captureException(wrappedError, {
        tags: { subsystem: 'sensor-fusion', provider: 'deepgram', videoId, isTimeout: String(isAbort) },
        extra: { timeoutMs: effectiveTimeoutMs, audioUrl: redactMediaUrl(audioUrl) },
      });

      throw wrappedError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Computes diarization metrics over word-level intervals (delegates to the shared reducer). */
  public static calculateMetrics(words: WordDiarization[]): DiarizationMetrics {
    return calculateDiarizationMetrics(words);
  }
}
