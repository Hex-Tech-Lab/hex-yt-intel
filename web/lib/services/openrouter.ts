/**
 * OpenRouter API client with multi-model fallback and adaptive execution windows.
 * Implements a prioritized waterfall: Free Models -> Paid Fallback (Haiku).
 */

import { getUCISPrompt } from '@/lib/prompts/factory';
import type { PersonaId } from '@/lib/prompts';
import type { VideoMetadata } from '@/lib/types';

export class AnalysisEngineError extends Error {
  code: string;
  statusCode: number;
  modelAttempted: string;

  constructor(opts: { message: string; code: string; statusCode: number; modelAttempted: string }) {
    super(opts.message);
    this.name = 'AnalysisEngineError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.modelAttempted = opts.modelAttempted;
  }
}

const MODEL_TIERS = [
  { model: 'anthropic/claude-haiku-4.5', tier: 'paid', cost: 0.0015 }, // Tier 0: Paid primary Claude Haiku 4.5
  { model: 'google/gemini-2.0-flash', tier: 'paid', cost: 0.00015 },   // Tier 1: Google Gemini 2.0 Flash (fallback 1)
  { model: 'google/gemini-1.5-flash', tier: 'paid', cost: 0.000075 },  // Tier 2: Google Gemini 1.5 Flash (fallback 2)
] as const;

/**
 * Read a failed response body for diagnostics without ever throwing.
 * OpenRouter error bodies are small JSON blobs; we cap the captured length.
 */
async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text ? text.slice(0, 500) : '<empty body>';
  } catch {
    return '<unreadable body>';
  }
}

/**
 * Executes a waterfall request to OpenRouter with recursive fallback.
 */
export async function callOpenRouter(
  metadata: VideoMetadata,
  transcript: string,
  persona: PersonaId,
  timezone: string,
  duration?: number,
  tierIndex: number = 0
): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

  const currentTier = MODEL_TIERS[tierIndex];
  if (!currentTier) {
    throw new AnalysisEngineError({
      message: 'All available analysis models exhausted or rate-limited.',
      code: 'ERR_ALL_MODELS_FAILED',
      statusCode: 503,
      modelAttempted: 'waterfall',
    });
  }

  const prompt = getUCISPrompt({
    version: '5.1',
    metadata,
    transcript,
    persona,
    timezone,
    duration,
  });

  const controller = new AbortController();
  const transcriptLength = transcript?.length || 0;
  
  // Handshake timeout (3s) + Adaptive streaming window (max 25s)
  const streamTimeout = Math.min(25000, 5000 + Math.floor(transcriptLength / 5000) * 1000);
  const timeoutId = setTimeout(() => controller.abort(), tierIndex === 0 ? 3000 : streamTimeout);

  try {
    const maxTokens = Math.min(3500, 3000 + Math.floor(transcript.length / 50));
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://hex-yt-intel.vercel.app',
        'X-Title': 'hex-yt-intel',
      },
      body: JSON.stringify({
        model: currentTier.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: maxTokens,
        provider: {
          sort: 'latency',
          allow_fallbacks: true,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Drain the body for diagnostics (never throws) before deciding routing.
      const errorBody = await safeReadBody(response);
      // 402 (Payment Required) and 429 (Too Many Requests) both signal that this
      // tier's quota/rate budget is exhausted — the cue to cascade or give up.
      const isQuotaSignal = response.status === 402 || response.status === 429;

      // Cascade to the next model while tiers remain.
      if (isQuotaSignal && tierIndex < MODEL_TIERS.length - 1) {
        console.warn(
          `[OpenRouter] Tier ${tierIndex} (${currentTier.model}) returned ${response.status}; cascading to next tier. Detail: ${errorBody}`
        );
        return callOpenRouter(metadata, transcript, persona, timezone, duration, tierIndex + 1);
      }

      // Waterfall exhausted on a quota/rate signal → emit a clean, UI-renderable
      // error distinguishing provider exhaustion from user quota.
      if (isQuotaSignal) {
        console.error(
          `[OpenRouter] Provider quota exhausted across all tiers. Last: ${currentTier.model} (${response.status}). Detail: ${errorBody}`
        );
        throw new AnalysisEngineError({
          message:
            'AI providers are currently overloaded. Please try again in a few minutes.',
          code: 'ERR_PROVIDER_QUOTA_EXHAUSTED',
          statusCode: 502,
          modelAttempted: currentTier.model,
        });
      }

      console.error(
        `[OpenRouter] Tier ${tierIndex} (${currentTier.model}) failed with ${response.status}. Detail: ${errorBody}`
      );
      throw new AnalysisEngineError({
        message: `Analysis engine failure (${response.status})`,
        code: 'ERR_MODEL_EXECUTION_FAILED',
        statusCode: response.status,
        modelAttempted: currentTier.model,
      });
    }

    const wrappedResponse = new Response(response.body, response);
    wrappedResponse.headers.set('x-model-meta', JSON.stringify({
      model: currentTier.model,
      cost: currentTier.cost,
      tier: currentTier.tier,
      timestamp: new Date().toISOString(),
    }));

    return wrappedResponse;
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError' && tierIndex < MODEL_TIERS.length - 1) {
      return callOpenRouter(metadata, transcript, persona, timezone, duration, tierIndex + 1);
    }
    throw err;
  }
}
