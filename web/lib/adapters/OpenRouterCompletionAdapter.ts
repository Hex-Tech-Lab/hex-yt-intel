import { env } from '@/lib/env';
import type { TextCompletionPort, CompletionModel } from '@/lib/ports/ExecutiveDigestPorts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HTTP_REFERER = 'https://yt-intel.getmytestdrive.com';
const REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 1400;

type ChatMessage = { role: string; content: string };

/**
 * Issue one non-streaming OpenRouter completion for a single cascade entry.
 * Returns the trimmed text (possibly empty). Throws on transport/HTTP failure
 * so the caller can advance to the next entry; the request self-aborts after
 * REQUEST_TIMEOUT_MS via AbortSignal.timeout (the rejection is surfaced here,
 * so there is no dangling abort left unsettled).
 */
async function requestCompletion(
  entry: CompletionModel,
  messages: readonly ChatMessage[],
  maxTokens: number
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': HTTP_REFERER,
      'X-Title': 'Hex YT Intel',
    },
    body: JSON.stringify({
      model: entry.model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
      ...(entry.providerOrder ? { provider: { order: entry.providerOrder, allow_fallbacks: true } } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status} for ${entry.model}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Non-streaming OpenRouter completion with cascade fallback. Used by the Dim-0
 * executive-digest pass — a single short synthesis, so no streaming machinery.
 * Tries each cascade entry (model + its own provider routing) in order; the
 * first that returns non-empty text wins.
 */
export class OpenRouterCompletionAdapter implements TextCompletionPort {
  async complete(params: {
    system: string;
    user: string;
    models: readonly CompletionModel[];
    maxTokens?: number;
    analysisId?: string;
  }): Promise<{ text: string; model: string }> {
    const { system, user, models, maxTokens = DEFAULT_MAX_TOKENS, analysisId } = params;
    const digestId = analysisId || `digest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    console.log(`[digest] Generating Dimension 0 analysis for analysisId=${digestId} timestamp=${new Date().toISOString()}`); // skipcq: JS-0827

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let lastError: Error | null = null;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const entry = models[modelIndex];
      const attemptStartTime = Date.now();

      try {
        const text = await requestCompletion(entry, messages, maxTokens);
        if (text.length > 0) {
          const durationMs = Date.now() - attemptStartTime;
          console.log(`[digest] Dimension 0 completed with model=${entry.model} durationMs=${durationMs} timestamp=${new Date().toISOString()}`); // skipcq: JS-0827
          return { text, model: entry.model };
        }

        lastError = new Error(`Empty completion from ${entry.model}`);

        // Log fallback if there's a next model
        if (modelIndex < models.length - 1) {
          const nextModel = models[modelIndex + 1].model;
          console.log(`[digest] Dimension 0 fallback from=${entry.model} to=${nextModel} reason=EmptyCompletion timestamp=${new Date().toISOString()}`); // skipcq: JS-0827
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = lastError.message;

        // Log fallback if there's a next model
        if (modelIndex < models.length - 1) {
          const nextModel = models[modelIndex + 1].model;
          console.log(`[digest] Dimension 0 fallback from=${entry.model} to=${nextModel} reason=${errorMsg} timestamp=${new Date().toISOString()}`); // skipcq: JS-0827
        }
      }
    }

    throw lastError ?? new Error('No models available for completion');
  }
}
