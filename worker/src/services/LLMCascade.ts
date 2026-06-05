/**
 * LLMCascade - LLM Transport Adapter (config-only)
 *
 * Implements ILLMCascade. Owns the OpenRouter multi-model fallback chain and the
 * two transport adapters (streaming + non-streaming). Config-only (apiKey): all
 * request-scoped state stays in method locals, so it is race-free when shared.
 */

import type { ILLMCascade } from '../ports/ILLMCascade';
import type { EngineMetadata, StreamStatusEvent } from '../ports/IReasoningEngine';

// 3-free + 1-paid model cascade – ordered best-first by a real latency+quality
// benchmark (2026-06-02) against the full v5.1 prompt. Under the ~55s request budget
// only ~1-2 attempts realistically complete, so tier 1 must be the proven performer.
//   - nemotron-3-nano-30b: ONLY free model that reliably produced valid 11-dim output
//     (3s first-token, 19-33s total). Lead model.
//   - glm-4.5-air / gemma-4-26b: $0 fallbacks, but volatile (429 / slow) — best effort.
//   - claude-haiku-4.5: paid last resort (needs OpenRouter credit; 402 while overdrawn).
// NOTE: ":free" IDs need their providers enabled in the OpenRouter account allowlist
// or they 404 "no allowed providers". Paid IDs must NOT carry ":free".
const MODEL_CHAIN = [
  { model: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano 30B' },
  { model: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air' },
  { model: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B' },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (paid fallback)' },
] as const;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HTTP_REFERER = 'https://yt-intel.hex-tech-lab.workers.dev';

export class LLMCascade implements ILLMCascade {
  private apiKey: string;
  // The ordered cascade actually used. Defaults to the hardcoded MODEL_CHAIN, but the
  // bouncer may inject a per-tier list (resolved from app_settings) — the DB config is
  // the override source of truth; MODEL_CHAIN is the safety-net fallback.
  private chain: ReadonlyArray<{ model: string; name: string }>;

  constructor(apiKey: string, models?: string[]) {
    this.apiKey = apiKey;
    this.chain =
      models && models.length > 0
        ? models.map((model) => ({ model, name: model }))
        : MODEL_CHAIN;
  }

  /**
   * Stream the cascade. Iterates MODEL_CHAIN, committing to the first model that
   * produces tokens. Emits 'model'/'fallback' lifecycle events via onStatus.
   * Falls through to the next model only if the current one never produced a token.
   */
  async streamCascade(
    systemPrompt: string,
    onDelta: (text: string) => void,
    onStatus?: (status: StreamStatusEvent) => void
  ): Promise<{ started: boolean; finalText: string; modelUsed: string }> {
    let finalText = '';
    let modelUsed = '';
    let produced = false;

    for (const { model, name } of this.chain) {
      console.log(`[LLMCascade] Attempting model: ${name} (${model})`);
      onStatus?.({ stage: 'model', model: name });
      modelUsed = name;

      const result = await this.callLLMStream(model, systemPrompt, (delta) => {
        finalText += delta;
        onDelta(delta);
      });

      if (result.started && finalText) {
        console.log(`[LLMCascade] Model ${name} started successfully. Committed.`);
        produced = true;
        break;
      }

      const errorMsg = result.error || 'No tokens produced';
      console.warn(`[LLMCascade] Model ${name} failed/skipped. Error: ${errorMsg}`);
      onStatus?.({ stage: 'fallback', from: name, error: errorMsg });
    }

    return { started: produced, finalText, modelUsed };
  }

  /**
   * Run the cascade without streaming (legacy /analyze-llm). Returns the first
   * model whose text passes `accept`, or null if every model failed/was-rejected.
   * Preserves the original per-model retry-on-invalid semantics.
   */
  async runCascade(
    systemPrompt: string,
    transcript: string,
    metadata: EngineMetadata,
    accept?: (text: string) => boolean
  ): Promise<{ text: string; modelUsed: string } | null> {
    for (const { model, name } of this.chain) {
      const result = await this.callLLM(model, systemPrompt, transcript, metadata);
      if (result.success && result.text) {
        if (!accept || accept(result.text)) {
          return { text: result.text, modelUsed: name };
        }
      }
    }
    return null;
  }

  // --- LLM transport (private adapters) ------------------------------------

  /**
   * Stream an OpenRouter chat completion, invoking onDelta for each content chunk.
   * Returns { started } = whether any token arrived (drives cascade fallback).
   */
  private async callLLMStream(
    model: string,
    systemPrompt: string,
    onDelta: (text: string) => void,
    timeoutMs = 90000
  ): Promise<{ started: boolean; text: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let text = '';
    let started = false;
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
        },
        body: JSON.stringify({
          model,
          temperature: 1,
          max_tokens: 16000,
          stream: true,
          // The system prompt (getUCISPrompt) already embeds the metadata + transcript
          // in its ACTIVE ANALYSIS SESSION block. Re-sending them here made the model
          // echo the prompt header instead of analyzing — so the user turn is just a
          // clean execution nudge.
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                'Begin the analysis now. Output only the structured UCIS v5.1 report starting at "### DIMENSION 1". Do not echo the metadata, transcript, or framework instructions.',
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        clearTimeout(timeout);
        const errBody = await response.text().catch(() => '');
        return { started: false, text: '', error: `${response.status}: ${errBody.slice(0, 160)}` };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              started = true;
              text += delta;
              onDelta(delta);
            }
          } catch {
            // ignore keep-alive / partial frames
          }
        }
      }
      clearTimeout(timeout);
      return { started, text };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { started, text, error: message === 'The operation was aborted' ? 'Request timeout' : message };
    }
  }

  /**
   * Call LLM without streaming (legacy /analyze-llm). Returns full text response.
   */
  private async callLLM(
    model: string,
    systemPrompt: string,
    transcript: string,
    metadata: EngineMetadata,
    timeoutMs = 45000
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
        },
        body: JSON.stringify({
          model,
          temperature: 1,
          // 16000 (not lower): nemotron-3-nano is a REASONING model that spends
          // ~4000 tokens on reasoning before the answer. An 8000 cap truncated the
          // 11-dimension output mid-stream and failed validation.
          max_tokens: 16000,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Analyze the following YouTube video transcript and metadata using the UCIS v5.1 framework.

**Metadata**:
${JSON.stringify(metadata, null, 2)}

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated...]' : ''}

Generate the complete 11-dimension analysis.`,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `${response.status}: ${error.slice(0, 200)}` };
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        return { success: false, error: 'Empty response from LLM' };
      }

      return { success: true, text };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message === 'The operation was aborted' ? 'Request timeout' : message };
    }
  }
}
