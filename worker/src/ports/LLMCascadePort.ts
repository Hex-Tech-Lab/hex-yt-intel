/**
 * LLMCascadePort — Domain Port (Hexagonal-Lite)
 *
 * The OpenRouter multi-model fallback cascade. Owns model selection and the
 * streaming/non-streaming transport adapters. Stateless / config-only: all
 * request-scoped state stays in method locals.
 */

import type { EngineMetadata, StreamStatusEvent } from './ReasoningEnginePort';

export interface LLMCascadePort {
  /**
   * Stream the cascade. Iterates the model chain and commits to the first model
   * that produces tokens. Emits 'model'/'fallback' lifecycle events via onStatus.
   */
  streamCascade(
    systemPrompt: string,
    onDelta: (text: string) => void,
    onStatus?: (status: StreamStatusEvent) => void,
    signal?: AbortSignal,
    /**
     * Prompt-cache split (2026-09-25): when set AND caching is enabled, the
     * request's system message becomes two content blocks -- `prefix` marked
     * with Anthropic `cache_control: { type: 'ephemeral' }` (identical across
     * all bundles of one video), `suffix` (bundle-specific instructions) left
     * uncached after the breakpoint. Contract: prefix + suffix === systemPrompt.
     */
    cacheSplit?: { prefix: string; suffix: string }
  ): Promise<{
    started: boolean;
    finalText: string;
    modelUsed: string;
    finishReason?: string;
    tokensUsed?: number;
    costUsd?: number;
    /** OpenRouter usage.prompt_tokens_details.cached_tokens (prompt cache reads). */
    cachedTokens?: number;
    generationId?: string;
  }>;

  /**
   * Run the cascade without streaming (legacy /analyze-llm). Returns the first
   * model whose text passes the optional `accept` predicate, or null if every
   * model failed/was-rejected. Preserves the original per-model retry-on-invalid
   * semantics: a model that produces text but fails `accept` is skipped.
   */
  runCascade(
    systemPrompt: string,
    transcript: string,
    metadata: EngineMetadata,
    accept?: (text: string) => boolean
  ): Promise<{ text: string; modelUsed: string } | null>;
}
