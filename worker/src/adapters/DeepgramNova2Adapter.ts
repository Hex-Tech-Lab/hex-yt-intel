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

  async diarizeAudioUrl(audioUrl: string, videoId: string): Promise<DiarizationResult> {
    const startTime = Date.now();
    const url = new URL(this.baseUrl);
    url.searchParams.set('model', this.model);
    url.searchParams.set('diarize', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('utterances', 'false');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

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
        const errorText = await response.text().catch(() => '');
        const error = new DeepgramDiarizationError(
          `Deepgram API HTTP ${response.status}: ${errorText || response.statusText}`,
          response.status,
          false,
        );
        Sentry.captureException(error, {
          tags: { subsystem: 'sensor-fusion', provider: 'deepgram', videoId },
          extra: { status: response.status, audioUrl },
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
          ? `Deepgram diarization timed out after ${this.timeoutMs}ms (fail-closed)`
          : `Deepgram diarization request failed: ${(err as Error)?.message || String(err)}`,
        isAbort ? 408 : 500,
        isAbort,
      );

      Sentry.captureException(wrappedError, {
        tags: { subsystem: 'sensor-fusion', provider: 'deepgram', videoId, isTimeout: String(isAbort) },
        extra: { timeoutMs: this.timeoutMs, audioUrl },
      });

      throw wrappedError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Native mathematical reduction over word-level timestamp intervals:
   * 1. speakerCount: cardinality of unique speaker indices.
   * 2. turnEntropy: Shannon entropy H = - \sum (p_i * log2(p_i)) over speaker speech durations.
   * 3. overlapRatio: sum of simultaneous speech intervals across different speakers divided by total speech time.
   */
  public static calculateMetrics(words: WordDiarization[]): DiarizationMetrics {
    if (!words || words.length === 0) {
      return {
        speakerCount: 0,
        turnEntropy: 0,
        overlapRatio: 0,
      };
    }

    const speakerDurations = new Map<number, number>();
    let totalSpeechDuration = 0;

    for (const w of words) {
      const duration = Math.max(0, w.end - w.start);
      if (duration > 0) {
        speakerDurations.set(w.speaker, (speakerDurations.get(w.speaker) || 0) + duration);
        totalSpeechDuration += duration;
      }
    }

    const speakerCount = speakerDurations.size;

    // 1. Calculate Shannon turnEntropy: H = - sum(p_i * log2(p_i))
    let turnEntropy = 0;
    if (totalSpeechDuration > 0 && speakerCount > 1) {
      for (const duration of speakerDurations.values()) {
        const p = duration / totalSpeechDuration;
        if (p > 0) {
          turnEntropy -= p * Math.log2(p);
        }
      }
    }

    // 2. Calculate overlapRatio (cross-talk / simultaneous speech between different speakers)
    let overlapDuration = 0;
    // Sort words by start timestamp to sweep overlap intervals in O(N log N)
    const sortedWords = [...words]
      .filter((w) => w.end > w.start)
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < sortedWords.length; i++) {
      const current = sortedWords[i]!;
      for (let j = i + 1; j < sortedWords.length; j++) {
        const next = sortedWords[j]!;
        // Beyond the current word's end boundary, no further overlap can occur
        if (next.start >= current.end) {
          break;
        }

        // Only count simultaneous speech if spoken by different speakers
        if (next.speaker !== current.speaker) {
          const overlapStart = Math.max(current.start, next.start);
          const overlapEnd = Math.min(current.end, next.end);
          const overlap = overlapEnd - overlapStart;
          if (overlap > 0) {
            overlapDuration += overlap;
          }
        }
      }
    }

    const overlapRatio =
      totalSpeechDuration > 0
        ? Math.min(1, Math.max(0, Math.round((overlapDuration / totalSpeechDuration) * 10000) / 10000))
        : 0;

    return {
      speakerCount,
      turnEntropy: Math.round(turnEntropy * 10000) / 10000,
      overlapRatio,
    };
  }
}
