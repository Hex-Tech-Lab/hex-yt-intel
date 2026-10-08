/**
 * AssemblyAIAdapter — Infrastructure Adapter (Hexagonal-Lite)
 *
 * Implements DiarizationProviderPort targeting AssemblyAI Universal-1
 * with speaker_labels enabled.
 *
 * Computes native speakerCount, Shannon turnEntropy, and overlapRatio
 * directly over word-level timestamp intervals returned by AssemblyAI.
 * Enforces a strict fail-closed timeout guard (15 seconds default for polling/transcription).
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

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  speechModel?: string;
  pollIntervalMs?: number;
}

export const ASSEMBLYAI_DEFAULT_TIMEOUT_MS = 15000;
export const ASSEMBLYAI_DEFAULT_SPEECH_MODEL = 'universal-1';
export const ASSEMBLYAI_DEFAULT_POLL_INTERVAL_MS = 1000;
export const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2/transcript';

interface AssemblyAIWordResponse {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string | number;
}

interface AssemblyAITranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  words?: AssemblyAIWordResponse[];
  audio_duration?: number;
}

/** Error thrown by the AssemblyAI diarization adapter on HTTP, API, or timeout failures. */
export class AssemblyAIDiarizationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isTimeout?: boolean,
  ) {
    super(message);
    this.name = 'AssemblyAIDiarizationError';
  }
}

/** DiarizationProviderPort adapter targeting AssemblyAI Universal-1 with speaker labels. */
export class AssemblyAIAdapter implements DiarizationProviderPort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly speechModel: string;
  private readonly pollIntervalMs: number;

  constructor(config: AssemblyAIConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('[AssemblyAIAdapter] AssemblyAI API key is required and cannot be empty.');
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl || ASSEMBLYAI_API_URL;
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : ASSEMBLYAI_DEFAULT_TIMEOUT_MS;
    this.speechModel = config.speechModel || ASSEMBLYAI_DEFAULT_SPEECH_MODEL;
    this.pollIntervalMs =
      config.pollIntervalMs && config.pollIntervalMs > 0 ? config.pollIntervalMs : ASSEMBLYAI_DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Submits the audio URL to AssemblyAI, polls to completion (fail-closed on
   * timeout), and computes diarization metrics over the returned word timings.
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      // Step 1: Submit transcription job
      const submitResponse = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          speaker_labels: true,
          speech_model: this.speechModel,
        }),
        signal: controller.signal,
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text().catch(() => '');
        const submitError = new AssemblyAIDiarizationError(
          `AssemblyAI submission HTTP ${submitResponse.status}: ${redactUrlsInText(errorText || submitResponse.statusText)}`,
          submitResponse.status,
          false,
        );
        Sentry.captureException(submitError, {
          tags: { subsystem: 'sensor-fusion', provider: 'assemblyai', videoId },
          extra: { status: submitResponse.status, audioUrl: redactMediaUrl(audioUrl) },
        });
        throw submitError;
      }

      const initialData = (await submitResponse.json()) as AssemblyAITranscriptResponse;
      const transcriptId = initialData.id;

      if (!transcriptId) {
        throw new AssemblyAIDiarizationError('AssemblyAI response missing transcript ID', 500, false);
      }

      // If already completed synchronously (rare, but supported by mock endpoints)
      let currentStatus = initialData.status;
      let transcriptData: AssemblyAITranscriptResponse = initialData;

      const pollUrl = `${this.baseUrl.replace(/\/$/, '')}/${transcriptId}`;

      // Step 2: Poll until completed, error, or abort
      while (currentStatus !== 'completed') {
        if (currentStatus === 'error') {
          const apiError = new AssemblyAIDiarizationError(
            `AssemblyAI transcription failed: ${redactUrlsInText(transcriptData.error || 'Unknown error')}`,
            500,
            false,
          );
          Sentry.captureException(apiError, {
            tags: { subsystem: 'sensor-fusion', provider: 'assemblyai', videoId },
            extra: { transcriptId, audioUrl: redactMediaUrl(audioUrl) },
          });
          throw apiError;
        }

        // Check timeout horizon before sleeping
        if (Date.now() - startTime >= effectiveTimeoutMs || controller.signal.aborted) {
          throw new AssemblyAIDiarizationError(
            `AssemblyAI diarization timed out after ${effectiveTimeoutMs}ms (fail-closed)`,
            408,
            true,
          );
        }

        await new Promise((resolve, reject) => {
          const timer = setTimeout(onSleepResolved, this.pollIntervalMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('AbortError'));
          };
          function onSleepResolved() {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(null);
          }
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });

        const pollResponse = await fetch(pollUrl, {
          method: 'GET',
          headers: {
            Authorization: this.apiKey,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!pollResponse.ok) {
          const errorText = await pollResponse.text().catch(() => '');
          const pollError = new AssemblyAIDiarizationError(
            `AssemblyAI poll HTTP ${pollResponse.status}: ${redactUrlsInText(errorText || pollResponse.statusText)}`,
            pollResponse.status,
            false,
          );
          Sentry.captureException(pollError, {
            tags: { subsystem: 'sensor-fusion', provider: 'assemblyai', videoId },
            extra: { transcriptId, status: pollResponse.status },
          });
          throw pollError;
        }

        transcriptData = (await pollResponse.json()) as AssemblyAITranscriptResponse;
        currentStatus = transcriptData.status;
      }

      const rawWords = transcriptData.words || [];

      // Map AssemblyAI speaker format (e.g. "A", "B" or numbers) into numeric speaker index
      const speakerMapping = new Map<string, number>();
      let nextSpeakerIndex = 0;

      const words: WordDiarization[] = rawWords.map((rawWord) => {
        const rawSpeakerKey = String(rawWord.speaker ?? '0');
        let mappedIndex = speakerMapping.get(rawSpeakerKey);
        if (mappedIndex === undefined) {
          mappedIndex = nextSpeakerIndex++;
          speakerMapping.set(rawSpeakerKey, mappedIndex);
        }

        // AssemblyAI timestamps are in milliseconds (integer), convert to seconds (float)
        const startSeconds = rawWord.start / 1000;
        const endSeconds = rawWord.end / 1000;

        return {
          word: rawWord.text,
          start: startSeconds,
          end: endSeconds,
          confidence: rawWord.confidence,
          speaker: mappedIndex,
        };
      });

      const metrics = AssemblyAIAdapter.calculateMetrics(words);
      const latencyMs = Date.now() - startTime;

      return {
        videoId,
        metrics,
        words,
        latencyMs,
      };
    } catch (err: unknown) {
      if (err instanceof AssemblyAIDiarizationError) {
        throw err;
      }

      const isAbort = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      const wrappedError = new AssemblyAIDiarizationError(
        isAbort
          ? `AssemblyAI diarization timed out after ${effectiveTimeoutMs}ms (fail-closed)`
          : `AssemblyAI diarization request failed: ${redactUrlsInText((err as Error)?.message || String(err))}`,
        isAbort ? 408 : 500,
        isAbort,
      );

      Sentry.captureException(wrappedError, {
        tags: { subsystem: 'sensor-fusion', provider: 'assemblyai', videoId, isTimeout: String(isAbort) },
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
