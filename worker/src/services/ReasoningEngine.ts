/**
 * ReasoningEngine - Pure Service
 *
 * HEXAGONAL ARCHITECTURE:
 * - PORT: IReasoningEngine (executeAndStream(context, handlers) / execute(context))
 * - ADAPTER: OpenRouter multi-model cascade + Upstash KV cache
 * - DOMAIN: UCIS prompt synthesis, model fallback, dimension parsing, 12D validation
 *
 * Encapsulates ALL LLM execution concerns:
 * - Multi-model fallback cascade (Nemotron → GLM → Gemma → Haiku)
 * - System prompt construction (UCIS v5.1, IP stays server-side)
 * - Streaming dimension parsing (markdown → JSON fragments)
 * - 12D structure validation
 * - Upstash KV caching (cache-aside, 7-day TTL)
 *
 * BOUNDARY: Accepts domain objects (transcript, metadata), emits domain events
 * (delta text, dimension fragments). Never touches raw HTTP Request/Response or SSE.
 * The orchestrator (worker.ts) owns transport; this engine owns reasoning.
 */

import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import { StreamingDimensionParser, DimensionFragment } from '../dimension-parser';

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

/** Domain metadata describing the source video. */
export interface EngineMetadata {
  title: string;
  channelTitle: string;
  publishedAt: string;
  duration: number;
  viewCount: string | number;
  likeCount: string | number;
  commentCount: string | number;
}

/** Domain input for a reasoning run. No HTTP, no transport — pure domain. */
export interface EngineContext {
  metadata: EngineMetadata;
  transcript: string;
  persona: string;
  timezone: string;
  /** Video id, used only as the deterministic cache-key suffix (legacy execute). */
  videoId?: string;
  /** Optional system prompt override (legacy /analyze-llm). Falls back to UCIS v5.1. */
  systemPrompt?: string;
}

/** Structured lifecycle event emitted during the cascade. */
export interface StreamStatusEvent {
  stage: 'model' | 'fallback';
  model?: string;
  from?: string;
  error?: string;
}

/** Domain event handlers the orchestrator wires to its transport (SSE). */
export interface StreamHandlers {
  /** Raw LLM text chunk (for terminal/processing log). */
  onDelta: (text: string) => void;
  /** Parsed dimension/complete fragment (for the Bento grid). */
  onFragment: (fragment: DimensionFragment) => void;
  /** Cascade lifecycle status (model selection, fallback). */
  onStatus?: (status: StreamStatusEvent) => void;
}

/** Result of a streaming reasoning run. */
export interface StreamResult {
  finalText: string;
  modelUsed: string;
  valid: boolean;
  produced: boolean;
}

/** Result of a non-streaming reasoning run. */
export interface ExecuteResult {
  success: boolean;
  analysis?: string;
  model?: string;
  cached?: boolean;
  valid?: boolean;
  error?: string;
}

export interface CacheConfig {
  url: string;
  token: string;
}

export class ReasoningEngine {
  private apiKey: string;
  private cache?: CacheConfig;

  constructor(apiKey: string, cache?: CacheConfig) {
    this.apiKey = apiKey;
    this.cache = cache;
  }

  /**
   * Build the UCIS v5.1 system prompt from domain objects.
   * The prompt IP is constructed here and never leaves the worker.
   */
  buildSystemPrompt(context: EngineContext): string {
    return getUCISPrompt({
      version: '5.1',
      metadata: {
        title: context.metadata.title,
        channelTitle: context.metadata.channelTitle,
        viewCount: String(context.metadata.viewCount ?? ''),
        likeCount: String(context.metadata.likeCount ?? ''),
        commentCount: String(context.metadata.commentCount ?? ''),
        publishedAt: context.metadata.publishedAt,
      },
      transcript: context.transcript || '',
      persona: (context.persona as any) || 'p1',
      timezone: context.timezone || 'UTC',
      duration: context.metadata.duration || 0,
    });
  }

  /**
   * Execute the cascade with streaming. Emits delta + dimension fragments through
   * the supplied handlers. Falls through to the next model only if the current one
   * never produced a token (cold 429/error) — once tokens stream we commit.
   */
  async executeAndStream(
    context: EngineContext,
    handlers: StreamHandlers
  ): Promise<StreamResult> {
    const systemPrompt = context.systemPrompt || this.buildSystemPrompt(context);
    const parser = new StreamingDimensionParser();

    let finalText = '';
    let modelUsed = '';
    let produced = false;

    for (const { model, name } of MODEL_CHAIN) {
      handlers.onStatus?.({ stage: 'model', model: name });
      modelUsed = name;

      const result = await this.callLLMStream(
        model,
        systemPrompt,
        (delta) => {
          finalText += delta;
          // Raw delta for terminal/processing log
          handlers.onDelta(delta);
          // Parse markdown into dimension JSON fragments for the grid
          const fragments = parser.feed(delta);
          fragments.forEach((frag) => handlers.onFragment(frag));
        }
      );

      if (result.started && finalText) {
        produced = true;
        break;
      }
      handlers.onStatus?.({ stage: 'fallback', from: name, error: result.error });
    }

    // Flush any trailing partial dimension
    if (produced || finalText) {
      const finalFragments = parser.finalize();
      finalFragments.forEach((frag) => handlers.onFragment(frag));
    }

    return {
      finalText,
      modelUsed,
      valid: this.validate12D(finalText),
      produced,
    };
  }

  /**
   * Execute the cascade without streaming (legacy /analyze-llm). Cache-aside via
   * Upstash when configured: returns cached markdown on hit, else runs the cascade
   * and writes the validated result back.
   */
  async execute(context: EngineContext): Promise<ExecuteResult> {
    const systemPrompt =
      context.systemPrompt ||
      `# UCIS v5.1 Analysis Framework
Your task is to analyze YouTube video transcripts across 11 dimensions using the UCIS v5.1 framework.
Provide comprehensive analysis with all 11 dimensions in markdown format.`;

    // Cache-aside read
    let cacheKey: string | null = null;
    if (this.cache) {
      const promptHash = await this.fingerprintSystemPrompt(systemPrompt);
      cacheKey = await this.buildCacheKey(
        promptHash,
        context.transcript.length,
        context.videoId || context.metadata.title
      );
      const cached = await this.getFromUpstash(cacheKey);
      if (cached && this.validate12D(cached)) {
        return { success: true, analysis: cached, model: 'cache-hit', cached: true, valid: true };
      }
    }

    // Cascade
    for (const { model, name } of MODEL_CHAIN) {
      const result = await this.callLLM(model, systemPrompt, context.transcript, context.metadata);
      if (result.success && result.text) {
        if (this.validate12D(result.text)) {
          if (this.cache && cacheKey) {
            await this.setUpstash(cacheKey, result.text);
          }
          return { success: true, analysis: result.text, model: name, cached: false, valid: true };
        }
      }
    }

    return { success: false, error: 'All models in cascade failed or validation failed' };
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

  // --- Validation ----------------------------------------------------------

  /**
   * Validate 11D analysis structure: requires at least 8/11 dimension headers.
   * Gate before caching / marking complete.
   */
  validate12D(analysis: unknown): boolean {
    if (typeof analysis !== 'string') return false;
    const requiredDimensions = [
      'DIMENSION 1', 'DIMENSION 2', 'DIMENSION 3', 'DIMENSION 4',
      'DIMENSION 5', 'DIMENSION 6', 'DIMENSION 7', 'DIMENSION 8',
      'DIMENSION 9', 'DIMENSION 10', 'DIMENSION 11',
    ];
    return requiredDimensions.filter((dim) => analysis.includes(dim)).length >= 8;
  }

  // --- Upstash KV cache ----------------------------------------------------

  private async fingerprintSystemPrompt(prompt: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(prompt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async buildCacheKey(
    systemPromptHash: string,
    transcriptLength: number,
    videoId: string
  ): Promise<string> {
    return `analysis::${systemPromptHash}::${transcriptLength}::${videoId}`;
  }

  private async getFromUpstash(key: string): Promise<string | null> {
    if (!this.cache) return null;
    try {
      const response = await fetch(`${this.cache.url}/get/${key}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cache.token}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { result: string | null };
      return data.result;
    } catch {
      console.warn('[ReasoningEngine] Upstash GET failed, proceeding without cache hit');
      return null;
    }
  }

  private async setUpstash(key: string, value: string): Promise<void> {
    if (!this.cache) return;
    try {
      await fetch(`${this.cache.url}/set/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cache.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ex: 604800, get: false, xx: false }),
      });
    } catch {
      console.warn('[ReasoningEngine] Upstash SET failed, analysis succeeded but not cached');
    }
  }
}
