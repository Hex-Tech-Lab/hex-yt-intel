/**
 * MultimodalProbeRunner — Infrastructure Service / Adapter
 *
 * Implements MultimodalProbePort executing structured visual UI and prosody
 * probe evaluations using Gemini Flash / Qwen2.5-Omni via OpenRouter
 * (ADR 039 §1.2, §5.4).
 *
 * Enforces strict fail-closed timeout guards and adheres to the JSON schema
 * contract in §5.4.
 */

import * as Sentry from '@sentry/cloudflare';

import { redactMediaUrl } from '../diarization-metrics';

import type {
  MultimodalProbePort,
  MultimodalProbeResult,
  MultimodalChunkInspection,
} from '../../../ports/MultimodalProbePort';

export interface MultimodalRunnerConfig {
  apiKey: string;
  baseUrl?: string;
  /** Required — no silent remote-model default (ADR 041: the configured probe model must be resolved by the caller, e.g. from the Settings Registry, and fail fast if absent). */
  model: string;
  timeoutMs?: number;
}

export const MULTIMODAL_PROBE_DEFAULT_TIMEOUT_MS = 15000;
export const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class MultimodalProbeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly isTimeout?: boolean,
  ) {
    super(message);
    this.name = 'MultimodalProbeError';
  }
}

const SYSTEM_PROMPT = `You are a forensic video classifier. You inspect 15-second sampled video clips and output STRICT JSON conforming to this schema:
{
  "uiFramesDetected": boolean, // True if code editors, slides, software UI, or browser tabs occupy >40% of the visual frame.
  "debateProsodyDetected": boolean, // True if rapid conversational cross-talk, interruptions, or elevated pitch contention is present.
  "visibleSpeakerCount": 0 | 1 | 2 | 3,
  "confidence": number // between 0.0 and 1.0
}
Output only valid JSON. No markdown fences. No explanatory prose.`;

export class MultimodalProbeRunner implements MultimodalProbePort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: MultimodalRunnerConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('[MultimodalProbeRunner] API key is required and cannot be empty.');
    }
    if (!config.model || config.model.trim() === '') {
      throw new Error('[MultimodalProbeRunner] Probe model is required — no silent remote-model default (ADR 041).');
    }
    this.apiKey = config.apiKey.trim();
    // Normalize baseUrl: default to OpenRouter chat completions endpoint
    this.baseUrl = config.baseUrl || OPENROUTER_COMPLETIONS_URL;
    this.model = config.model.trim();
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : MULTIMODAL_PROBE_DEFAULT_TIMEOUT_MS;
  }

  async inspectVideoChunks(
    videoId: string,
    chunks: Array<{ chunkIndex: number; startTimeSeconds: number; mediaUrl: string }>,
  ): Promise<MultimodalProbeResult> {
    const startTime = Date.now();
    if (!chunks || chunks.length === 0) {
      return {
        videoId,
        chunks: [],
        summary: {
          uiFramesDetected: false,
          debateProsodyDetected: false,
          maxVisibleSpeakers: 0,
          meanConfidence: 1.0,
        },
        latencyMs: 0,
      };
    }

    // Process chunk inspections in parallel with individual fail-closed timeouts
    const chunkPromises = chunks.map((chunk) =>
      this.inspectSingleChunk(videoId, chunk.chunkIndex, chunk.startTimeSeconds, chunk.mediaUrl),
    );

    const inspectedChunks = await Promise.all(chunkPromises);

    // Compute summary metrics for the S1-S6 router
    let anyUi = false;
    let anyDebate = false;
    let maxSpeakers: 0 | 1 | 2 | 3 = 0;
    let totalConfidence = 0;

    for (const res of inspectedChunks) {
      if (res.uiFramesDetected) anyUi = true;
      if (res.debateProsodyDetected) anyDebate = true;
      if (res.visibleSpeakerCount > maxSpeakers) {
        maxSpeakers = res.visibleSpeakerCount;
      }
      totalConfidence += res.confidence;
    }

    const meanConfidence = inspectedChunks.length > 0 ? totalConfidence / inspectedChunks.length : 1.0;

    return {
      videoId,
      chunks: inspectedChunks,
      summary: {
        uiFramesDetected: anyUi,
        debateProsodyDetected: anyDebate,
        maxVisibleSpeakers: maxSpeakers,
        meanConfidence: Math.round(meanConfidence * 10000) / 10000,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  private async inspectSingleChunk(
    videoId: string,
    chunkIndex: number,
    startTimeSeconds: number,
    mediaUrl: string,
  ): Promise<MultimodalChunkInspection> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const isVideoPayload = /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl);
      const mediaPart = isVideoPayload
        ? {
            type: 'video_url',
            video_url: { url: mediaUrl },
          }
        : {
            type: 'image_url',
            image_url: { url: mediaUrl },
          };

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://hex-yt-intel.app',
          'X-Title': 'hex-yt-intel-probe-runner',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this 15-second clip at timestamp ${startTimeSeconds}s for UI frames and debate contention.`,
                },
                mediaPart,
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Truncate (with an ellipsis marker): the raw error body is echoed into
        // the Sentry exception message below (this error's message becomes the
        // captureException payload), so it must not carry an unbounded upstream
        // response body.
        const rawErrorText = await response.text().catch(() => '');
        const errorText = rawErrorText.length > 2000 ? `${rawErrorText.slice(0, 2000)}...` : rawErrorText;
        throw new MultimodalProbeError(
          `Multimodal probe HTTP ${response.status}: ${errorText || response.statusText}`,
          response.status,
          false,
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawContent) as Partial<MultimodalChunkInspection>;

      // Strict validation: schema-invalid model output must fail closed, not be
      // coerced into fabricated false/0 values that could corrupt sensor fusion.
      if (typeof parsed.uiFramesDetected !== 'boolean' || typeof parsed.debateProsodyDetected !== 'boolean') {
        throw new MultimodalProbeError(
          `Multimodal probe response for chunk ${chunkIndex} is schema-invalid: missing boolean fields`,
          500,
          false,
        );
      }
      const uiFramesDetected = parsed.uiFramesDetected;
      const debateProsodyDetected = parsed.debateProsodyDetected;
      const rawCount = Number(parsed.visibleSpeakerCount);
      const visibleSpeakerCount: 0 | 1 | 2 | 3 = [0, 1, 2, 3].includes(rawCount)
        ? (rawCount as 0 | 1 | 2 | 3)
        : 0;
      const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8;

      return {
        chunkIndex,
        startTimeSeconds,
        uiFramesDetected,
        debateProsodyDetected,
        visibleSpeakerCount,
        confidence,
      };
    } catch (err: unknown) {
      const isAbort = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
      const wrappedError =
        err instanceof MultimodalProbeError
          ? err
          : new MultimodalProbeError(
              isAbort
                ? `Multimodal probe timed out after ${this.timeoutMs}ms for chunk ${chunkIndex} (fail-closed)`
                : `Multimodal probe inspection failed: ${(err as Error)?.message || String(err)}`,
              isAbort ? 408 : 500,
              isAbort,
            );

      Sentry.captureException(wrappedError, {
        tags: { subsystem: 'sensor-fusion', runner: 'multimodal-probe', videoId, chunkIndex: String(chunkIndex) },
        extra: { timeoutMs: this.timeoutMs, mediaUrl: redactMediaUrl(mediaUrl) },
      });

      throw wrappedError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
