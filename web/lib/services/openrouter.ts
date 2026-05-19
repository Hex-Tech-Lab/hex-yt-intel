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
  const errors: Record<string, string> = {};

  console.log('[callOpenRouter] Starting with models', { models: models.join(', ') });

  for (const model of models) {
    console.log('[callOpenRouter] Attempting model', { model });
    const controller = new AbortController();
    let connectTimeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // 3-second connection timeout: detects network faults early
      connectTimeoutId = setTimeout(() => {
        console.warn('[callOpenRouter] Connection timeout (10s)', { model });
        controller.abort();
      }, 10000);

      console.log('[callOpenRouter] Sending request to OpenRouter', { model, stream: true });
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://hex-yt-intel.vercel.app',
          'X-Title': 'hex-yt-intel',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(connectTimeoutId);
      connectTimeoutId = undefined;

      console.log('[callOpenRouter] Response received', { model, status: response.status, ok: response.ok });

      if (!response.ok) {
        const status = response.status;
        const errorBody = await response.text().catch(() => '<unreadable>');
        errors[model] = `HTTP ${status}: ${errorBody.slice(0, 200)}`;

        // Service errors: retry with fallback model
        if (status === 429 || status === 503) {
          console.warn(`[callOpenRouter] ${model}: ${status} - trying fallback model`);
          continue;
        }

        // Auth errors: fail immediately
        if (status === 401 || status === 403) {
          console.error(`[callOpenRouter] Auth error - ${status}`, { model, errorBody });
          throw new AnalysisEngineError({
            message: `OpenRouter auth failed (${status}). Check OPENROUTER_API_KEY.`,
            code: 'ERR_PROVIDER_AUTH_FAILED',
            statusCode: status,
            modelAttempted: model,
          });
        }

        // 400 = model not found or payload rejected
        if (status === 400) {
          console.error(`[callOpenRouter] 400 Bad Request - ${model}`, { errorBody: errorBody.slice(0, 500) });
        } else {
          console.error(`[callOpenRouter] HTTP error - ${status}`, { model, errorBody: errorBody.slice(0, 200) });
        }
        continue;
      }

      console.log('[callOpenRouter] Stream response accepted', { model });
      return response;
    } catch (err) {
      if (err instanceof AnalysisEngineError) {
        if (err.code === 'ERR_PROVIDER_AUTH_FAILED') {
          console.error('[callOpenRouter] Auth error - not retrying', { model, code: err.code });
          throw err;
        }
        console.warn('[callOpenRouter] Typed error, trying next model', { model, code: err.code, message: err.message });
        errors[model] = err.message;
        continue;
      }

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          console.warn('[callOpenRouter] Abort error (timeout or cancel)', { model });
          errors[model] = 'Connection timeout (10s)';
          continue;
        }
        console.warn('[callOpenRouter] Unexpected error, trying next model', { model, error: err.message });
        errors[model] = err.message;
      } else {
        console.warn('[callOpenRouter] Unexpected error, trying next model', { model, error: String(err) });
        errors[model] = String(err);
      }
      continue;
    } finally {
      if (connectTimeoutId !== undefined) clearTimeout(connectTimeoutId);
    }
  }

  // All models exhausted
  console.error('[callOpenRouter] All models exhausted', { attemptedModels: models, errors });
  throw new AnalysisEngineError({
    message: 'All OpenRouter models failed or unavailable',
    code: 'ERR_ALL_MODELS_EXHAUSTED',
    statusCode: 503,
    modelAttempted: models[0]!,
    meta: { errors },
  });
}
