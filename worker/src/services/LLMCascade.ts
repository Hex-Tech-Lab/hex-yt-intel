/**
 * See docs/reference/llm-cascade.md
 * qa-intel: no stream state here to call settleAnalysis or setError
 */

import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { EngineMetadata, StreamStatusEvent } from '../ports/ReasoningEnginePort';
import { translateModelId } from './model-id-translator';

// 3-free + 1-paid model cascade – ordered best-first by a real latency+quality
// benchmark (2026-06-02) against the full v5.1 prompt. Under the ~55s request budget
// only ~1-2 attempts realistically complete, so tier 1 must be the proven performer.
//   - nemotron-3-nano-30b: ONLY free model that reliably produced valid 11-dim output
//     (3s first-token, 19-33s total). Lead model.
//   - gemini-2.0-flash: fast, sub-second TTFB, highly reliable.
//   - claude-haiku-4.5: paid last resort (needs OpenRouter credit; 402 while overdrawn).
// NOTE: ":free" IDs need their providers enabled in the OpenRouter account allowlist
// or they 404 "no allowed providers". Paid IDs must NOT carry ":free".
import { ANALYSIS_CASCADE } from '../../../web/lib/config/cascade';

const MODEL_CHAIN = ANALYSIS_CASCADE;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HTTP_REFERER = 'https://yt-intel.hex-tech-lab.workers.dev';

export class LLMCascade implements LLMCascadePort {
  private apiKey: string;
  // The ordered cascade actually used. Defaults to the hardcoded MODEL_CHAIN, but the
  // bouncer may inject a per-tier list (resolved from app_settings) — the DB config is
  // the override source of truth; MODEL_CHAIN is the safety-net fallback.
  private chain: ReadonlyArray<{ model: string; name: string; providerOrder?: readonly string[] }>;

  constructor(apiKey: string, models?: string[]) {
    this.apiKey = apiKey;
    if (models && models.length > 0) {
      this.chain = models.map((model, idx) => {
        if (MODEL_CHAIN[idx] && MODEL_CHAIN[idx].model === model) {
          return MODEL_CHAIN[idx];
        }
        const matched = MODEL_CHAIN.find((item) => item.model === model);
        return {
          model,
          name: matched?.name ?? model,
          providerOrder: matched?.providerOrder,
        };
      });
    } else {
      this.chain = MODEL_CHAIN;
    }
  }

  /**
   * Stream the cascade. Iterates MODEL_CHAIN, committing to the first model that
   * produces tokens. Emits 'model'/'fallback' lifecycle events via onStatus.
   * Falls through to the next model only if the current one never produced a token.
   */
  async streamCascade(
    systemPrompt: string,
    onDelta: (text: string) => void,
    onStatus?: (status: StreamStatusEvent) => void,
    signal?: AbortSignal
  ): Promise<{ started: boolean; finalText: string; modelUsed: string }> {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let finalText = '';
    let modelUsed = '';
    let produced = false;
    let previousModel: string | null = null;

    for (let tierIndex = 0; tierIndex < this.chain.length; tierIndex++) {
      const { model, name, providerOrder } = this.chain[tierIndex];

      if (signal?.aborted) {
        // skipcq: JS-0827
        console.warn(`[LLMCascade] Stream ${streamId} cascade aborted before tier ${tierIndex}`);
        break;
      }

      const attemptStartTime = Date.now();
      // skipcq: JS-0827
      console.log(`[LLMCascade] Stream ${streamId} attempting model=${name} tier=${tierIndex} timestamp=${new Date().toISOString()}`);
      onStatus?.({ stage: 'model', model: name });
      modelUsed = name;

      const result = await this.callLLMStream(
        model,
        systemPrompt,
        (delta) => {
          finalText += delta;
          onDelta(delta);
        },
        120000,
        signal,
        providerOrder as string[] | undefined
      );

      if (result.started && finalText && !result.error) {
        const durationMs = Date.now() - attemptStartTime;
        // skipcq: JS-0827
        console.log(`[LLMCascade] Stream ${streamId} succeeded with model=${name} durationMs=${durationMs} timestamp=${new Date().toISOString()}`);
        produced = true;
        break;
      }

      // If it failed/refused mid-stream, log fallback and run the next model in cascade
      finalText = '';
      const rawError = result.error || 'No tokens produced';
      const classifiedError = classifyError(rawError);

      if (previousModel === null) {
        previousModel = name;
      }

      if (tierIndex < this.chain.length - 1) {
        const nextModel = this.chain[tierIndex + 1].name;
        // skipcq: JS-0827
        console.log(`[LLMCascade] Stream ${streamId} fallback from=${previousModel} to=${nextModel} reason=${classifiedError} timestamp=${new Date().toISOString()}`);
      }

      // skipcq: JS-0827
      console.warn(`[LLMCascade] Stream ${streamId} tier ${tierIndex} failed. Raw: ${rawError}, Classified: ${classifiedError}`);
      onStatus?.({ stage: 'fallback', from: name, error: classifiedError, rawError });
      previousModel = name;
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
    for (const { model, name, providerOrder } of this.chain) {
      const result = await this.callLLM(
        model,
        systemPrompt,
        transcript,
        metadata,
        45000,
        providerOrder as string[] | undefined
      );
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
    timeoutMs = 120000,
    signal?: AbortSignal,
    providerOrder?: string[]
  ): Promise<{ started: boolean; text: string; error?: string }> {
    const controller = new AbortController();
    const handshakeTimer = setTimeout(() => {
      // skipcq: JS-0827
      console.warn(`[LLMCascade] Handshake timeout (15s exceeded) for model ${model}`);
      controller.abort();
    }, 15000);
    const totalTimer = setTimeout(() => {
      // skipcq: JS-0827
      console.warn(`[LLMCascade] Total execution timeout (${timeoutMs}ms exceeded) for model ${model}`);
      controller.abort();
    }, timeoutMs);
    let text = '';
    let started = false;

    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(handshakeTimer);
        clearTimeout(totalTimer);
        return { started: false, text: '', error: 'Request aborted' };
      }
      signal.addEventListener('abort', onAbort);
    }

    const isHaiku45 = model === 'anthropic/claude-haiku-4.5';
    const requestModel = translateModelId(model);
    const requestMaxTokens = isHaiku45 ? 62000 : 16000;
    const requestProvider = isHaiku45
      ? { order: ['Amazon', 'Anthropic', 'Google'], allow_fallbacks: false }
      : (providerOrder ? { order: providerOrder, allow_fallbacks: true } : undefined);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': 'Hex YT Intel',
        },
        body: JSON.stringify({
          model: requestModel,
          temperature: 1,
          max_tokens: requestMaxTokens,
          stream: true,
          // The system prompt (getUCISPrompt) already embeds the metadata + transcript
          // in its ACTIVE ANALYSIS SESSION block. Re-sending them here made the model
          // echo the prompt header instead of analyzing.
          messages: [
            { role: 'system', content: systemPrompt },
          ],
          ...(requestProvider ? { provider: requestProvider } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(handshakeTimer);

      if (!response.ok || !response.body) {
        clearTimeout(totalTimer);
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
        const lines = buffer.split(/\r?\n/);
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

              // Early refusal/safety block detection
              if (text.length >= 20 && text.length <= 400) {
                if (isRefusalOrChatter(text)) {
                  throw new Error('ERR_MODEL_REFUSAL: Safety refusal or conversational chatter detected early in stream');
                }
              }

              onDelta(delta);
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('ERR_MODEL_REFUSAL')) {
              throw e;
            }
            // ignore keep-alive / partial frames
          }
        }
      }
      clearTimeout(totalTimer);
      return { started, text };
    } catch (error) {
      clearTimeout(handshakeTimer);
      clearTimeout(totalTimer);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { started, text, error: message === 'The operation was aborted' ? 'Request timeout' : message };
    } finally {
      clearTimeout(handshakeTimer);
      clearTimeout(totalTimer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
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
    timeoutMs = 45000,
    providerOrder?: string[]
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const isHaiku45 = model === 'anthropic/claude-haiku-4.5';
    const requestModel = translateModelId(model);
    const requestMaxTokens = isHaiku45 ? 62000 : 16000;
    const requestProvider = isHaiku45
      ? { order: ['Amazon', 'Anthropic', 'Google'], allow_fallbacks: false }
      : (providerOrder ? { order: providerOrder, allow_fallbacks: true } : undefined);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': 'Hex YT Intel',
        },
        body: JSON.stringify({
          model: requestModel,
          temperature: 1,
          max_tokens: requestMaxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
          ],
          ...(requestProvider ? { provider: requestProvider } : {}),
        }),
        signal: controller.signal,
      });

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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message === 'The operation was aborted' ? 'Request timeout' : message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Early safety refusal or conversational chatter detector.
 * Scans initial token output for typical system refusals or prompts asking what to do.
 */
function isRefusalOrChatter(text: string): boolean {
  const clean = text.trim().toLowerCase();
  
  const refusalKeywords = [
    'i cannot',
    'i am unable',
    "i'm sorry",
    'as an ai',
    'safety guidelines',
    'ethical guidelines',
    'cannot fulfill',
    'against my instructions',
    'inappropriate content',
    'cannot assist',
    'not comfortable',
    'would violate'
  ];
  
  const chatterKeywords = [
    'what should i do',
    'what would you like me to do',
    'please provide the',
    'how can i assist',
    'how can i help',
    'would you like me to'
  ];

  for (const kw of refusalKeywords) {
    if (clean.includes(kw)) return true;
  }
  for (const kw of chatterKeywords) {
    if (clean.includes(kw)) return true;
  }

  return false;
}

/**
 * Maps raw provider/OpenRouter errors to clean, user-friendly error codes.
 */
function classifyError(errorMsg: string): string {
  const clean = errorMsg.toLowerCase();
  if (clean.includes('err_model_refusal') || clean.includes('refusal') || clean.includes('safety') || clean.includes('ethical')) {
    return 'ERR_MODEL_REFUSAL';
  }
  if (clean.includes('429') || clean.includes('rate limit') || clean.includes('too many requests') || clean.includes('overloaded')) {
    return 'ERR_MODEL_OVERLOAD';
  }
  if (clean.includes('402') || clean.includes('credit') || clean.includes('payment required') || clean.includes('insufficient balance')) {
    return 'ERR_MONTHLY_QUOTA_EXHAUSTED';
  }
  if (clean.includes('timeout') || clean.includes('aborted') || clean.includes('deadline')) {
    return 'ERR_CONNECTION_TIMEOUT';
  }
  return 'ERR_INTERNAL_PROVIDER_FAULT';
}



