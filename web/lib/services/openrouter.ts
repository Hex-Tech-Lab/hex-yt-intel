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
 * Calls OpenRouter API with multi-model fallback strategy
 * - Attempts primary model first (Claude Haiku 4.5)
 * - Falls back to secondary model on service errors (429, 503)
 * - Fails immediately on auth errors (401, 403)
 * - Implements connection timeout + streaming response
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

  const models = ['anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku'];
  
  console.log('[callOpenRouter] Sending request to OpenRouter with native fallback models', { models });
  const controller = new AbortController();
  const connectTimeoutId = setTimeout(() => {
    console.warn('[callOpenRouter] Connection timeout (10s)');
    controller.abort();
  }, 10000);

  try {
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
      }),
      signal: controller.signal,
    });

    clearTimeout(connectTimeoutId);

    if (!response.ok) {
      const status = response.status;
      const errorBody = await response.text().catch(() => '<unreadable>');
      
      if (status === 401 || status === 403) {
        throw new AnalysisEngineError({
          message: `OpenRouter auth failed (${status}). Check OPENROUTER_API_KEY.`,
          code: 'ERR_PROVIDER_AUTH_FAILED',
          statusCode: status,
          modelAttempted: 'auto-routed',
        });
      }
      throw new Error(`OpenRouter HTTP ${status}: ${errorBody.slice(0, 200)}`);
    }

    console.log('[callOpenRouter] Stream response accepted');
    return response;
  } catch (err) {
    clearTimeout(connectTimeoutId);
    throw err;
  }
}
