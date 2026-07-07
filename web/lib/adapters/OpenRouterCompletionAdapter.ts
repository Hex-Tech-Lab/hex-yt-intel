import { env } from '@/lib/env';
import { CHAT_CASCADE } from '@/lib/config/cascade';
import type { TextCompletionPort } from '@/lib/ports/ExecutiveDigestPorts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HTTP_REFERER = 'https://yt-intel.getmytestdrive.com';

/** Per-model provider routing hints, sourced from the shared cascade config. */
const PROVIDER_ORDER = new Map<string, readonly string[]>(
  CHAT_CASCADE.filter((c) => c.providerOrder).map((c) => [c.model, c.providerOrder as readonly string[]])
);

/**
 * Non-streaming OpenRouter completion with cascade fallback. Used by the Dim-0
 * executive-digest pass — a single short synthesis, so no streaming machinery.
 * Tries each model in order; the first that returns non-empty text wins.
 */
export class OpenRouterCompletionAdapter implements TextCompletionPort {
  async complete(params: {
    system: string;
    user: string;
    models: readonly string[];
    maxTokens?: number;
  }): Promise<{ text: string; model: string }> {
    const { system, user, models, maxTokens = 1400 } = params;
    const apiKey = env.openrouterApiKey;

    let lastError: Error | null = null;
    for (const model of models) {
      const providerOrder = PROVIDER_ORDER.get(model);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45_000);
        let response: Response;
        try {
          response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': HTTP_REFERER,
              'X-Title': 'Hex YT Intel',
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              temperature: 0.3,
              max_tokens: maxTokens,
              ...(providerOrder ? { provider: { order: providerOrder, allow_fallbacks: true } } : {}),
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          lastError = new Error(`OpenRouter ${response.status} for ${model}`);
          continue;
        }

        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (text.length > 0) {
          return { text, model };
        }
        lastError = new Error(`Empty completion from ${model}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('No models available for completion');
  }
}
