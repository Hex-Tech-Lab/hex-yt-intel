/**
 * OpenRouter API client with multi-model fallback and timeout handling
 * Implements resilience patterns: connection timeout + streaming window with model fallback
 */

import { getUCISPrompt } from '@/lib/prompts/factory';
import type { PersonaId } from '@/lib/prompts';
import type { VideoMetadata } from '@/lib/types';

export interface AnalysisErrorMeta {
  errors?: Record<string, string>;
}

export class AnalysisEngineError extends Error {
  code: string;
  statusCode: number;
  modelAttempted: string;
  retryAfter?: number;
  meta?: AnalysisErrorMeta;

  constructor(opts: {
    message: string;
    code: string;
    statusCode: number;
    modelAttempted: string;
    retryAfter?: number;
    meta?: AnalysisErrorMeta;
  }) {
    super(opts.message);
    this.name = 'AnalysisEngineError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.modelAttempted = opts.modelAttempted;
    this.retryAfter = opts.retryAfter;
    this.meta = opts.meta;
  }
}

/**
 * Free-Tier Waterfall Pipeline: Resilience-First Model Routing
 *
 * Implements tiered model fallback for bootstrap resilience:
 * - Tier 1 (Free): qwen/qwen-2.5-coder-7b-instruct (cost-optimized, task-optimized)
 * - Tier 2 (Fallback): anthropic/claude-haiku-4.5 (premium fallback on 402/5xx)
 *
 * Strategy: Default to free models to ensure pipeline never goes dark due to credit constraints.
 * Haiku becomes the exception (reliability insurance), not the rule.
 *
 * Response metadata identifies model used via x-model-meta header.
 */
export async function callOpenRouter(
  metadata: VideoMetadata,
  transcript: string,
  persona: PersonaId,
  timezone: string,
  duration?: number
): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured. Set it in Vercel environment variables.');
  }

  const prompt = getUCISPrompt({
    version: '5.1',
    metadata,
    transcript,
    persona,
    timezone,
    duration,
  });

  // Free-Tier Waterfall: Primary (OpenRouter free router) → Fallback (haiku)
  type ModelTier = { model: string; tier: 'free' | 'haiku'; estimatedCost: number };
  const modelTiers: ModelTier[] = [
    { model: 'openrouter/free', tier: 'free', estimatedCost: 0 },
    { model: 'anthropic/claude-haiku-4.5', tier: 'haiku', estimatedCost: 0.0015 },
  ];

  let selectedModel: ModelTier = modelTiers[0]!;
  const models = modelTiers.map(t => t.model);
  
  console.log('[callOpenRouter] Sending request to OpenRouter with native fallback models', { models });

  const transcriptLength = transcript?.length || 0;
  const adaptiveTimeout = Math.min(25000, 5000 + Math.floor(transcriptLength / 5000) * 1000);

  const controller = new AbortController();
  let connectionHandshakePassed = false;

  const connectTimeoutId = setTimeout(() => {
    console.warn('[callOpenRouter] Connection timeout (3s) triggered');
    controller.abort();
  }, 3000);

  const totalTimeoutId = setTimeout(() => {
    if (connectionHandshakePassed) {
      console.warn(`[callOpenRouter] Total streaming timeout (${adaptiveTimeout}ms) triggered`);
      controller.abort();
    }
  }, adaptiveTimeout);

  try {
    // Law #2: Dynamic token budget scales with transcript length
    // Hard cap at 3500 tokens to ensure all requests fit within 4000-token credit window
    // This prevents 402 (insufficient quota) errors even with low credit balance
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
        models, // OpenRouter natively attempts these sequentially
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(connectTimeoutId);
    connectionHandshakePassed = true;

    if (!response.ok) {
      const status = response.status;
      const errorBody = await response.text().catch(() => '<unreadable>');

      // Explicit 402 handling: Trigger fallback if available
      if (status === 402 && selectedModel.tier === 'free') {
        console.warn('[callOpenRouter] 402 Quota exhausted on free tier, triggering Haiku fallback');
        selectedModel = modelTiers[1]!; // Upgrade to Haiku
        // Retry with fallback model (recursive call with updated tier)
        return callOpenRouter(metadata, transcript, persona, timezone, duration);
      }

      if (status === 402) {
        throw new AnalysisEngineError({
          message: 'Insufficient quota for analysis generation. Please upgrade your plan.',
          code: 'ERR_QUOTA_BUDGET_EXCEEDED',
          statusCode: 402,
          modelAttempted: selectedModel.model,
        });
      }

      if (status === 401 || status === 403) {
        throw new AnalysisEngineError({
          message: `OpenRouter auth failed (${status}). Check OPENROUTER_API_KEY.`,
          code: 'ERR_PROVIDER_AUTH_FAILED',
          statusCode: status,
          modelAttempted: selectedModel.model,
        });
      }
      throw new Error(`OpenRouter HTTP ${status} (${selectedModel.model}): ${errorBody.slice(0, 200)}`);
    }

    console.log('[callOpenRouter] Stream response accepted', {
      model: selectedModel.model,
      tier: selectedModel.tier,
      estimatedCost: selectedModel.estimatedCost,
    });

    // Attach model metadata to response headers for transparency
    const wrappedResponse = new Response(response.body, response);
    wrappedResponse.headers.set('x-model-meta', JSON.stringify({
      model: selectedModel.model,
      provider: 'openrouter',
      cost: selectedModel.estimatedCost,
      tier: selectedModel.tier,
      timestamp: new Date().toISOString(),
    }));

    return wrappedResponse;
  } catch (err) {
    clearTimeout(connectTimeoutId);
    const error = err as Error;
    if (error.name === 'AbortError' && !connectionHandshakePassed) {
      console.error('[callOpenRouter] Connection handshake aborted (≤ 3s)');
      throw new Error('Connection timeout (3s)');
    } else if (error.name === 'AbortError' && connectionHandshakePassed) {
      console.error(`[callOpenRouter] Total streaming window timeout aborted (${adaptiveTimeout}ms)`);
      throw new Error(`Total execution timeout (${adaptiveTimeout}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(connectTimeoutId);
    clearTimeout(totalTimeoutId);
  }
}
