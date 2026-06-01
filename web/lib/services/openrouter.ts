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
  { model: 'nvidia/nemotron-3-super-120b-a12b:free', tier: 'free', cost: 0 },
  { model: 'poolside/laguna-m.1-20260312:free', tier: 'free', cost: 0 },
  { model: 'z-ai/glm-4.5-air:free', tier: 'free', cost: 0 },
  { model: 'anthropic/claude-haiku-4.5', tier: 'paid', cost: 0.0015 },
] as const;

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
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Cascade to next model on 402 (Payment Required) or 429 (Too Many Requests)
      if ((response.status === 402 || response.status === 429) && tierIndex < MODEL_TIERS.length - 1) {
        return callOpenRouter(metadata, transcript, persona, timezone, duration, tierIndex + 1);
      }
      
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
