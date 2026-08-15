/**
 * ReasoningEngine - Thin Orchestrator (Hexagonal-Lite)
 *
 * HEXAGONAL ARCHITECTURE:
 * - PORT: ReasoningEnginePort (executeAndStream(context, handlers) / execute(context))
 * - DEPENDENCIES (constructor DI):
 *     PromptBuilderPort      — UCIS v5.1 prompt synthesis (IP stays server-side)
 *     LLMCascadePort         — OpenRouter multi-model fallback (streaming + batch)
 *     ValidationService      — 11D structure validation
 *     PersistenceRepositoryPort — Upstash KV cache (optional; insulated behind port)
 *
 * The engine owns ONLY orchestration + the per-stream BracketBuffer parser. It holds no
 * request-scoped mutable state on shared sub-services — each is stateless/config-only,
 * and a fresh BracketBuffer is created per stream — so DI is race-free even though
 * worker.ts constructs the engine per-request.
 *
 * BOUNDARY: Accepts domain objects (transcript, metadata), emits domain events
 * (delta text, dimension fragments). Never touches raw HTTP Request/Response or SSE.
 * The orchestrator (worker.ts) owns transport; this engine owns reasoning.
 */

import * as Sentry from '@sentry/cloudflare';
import { BracketBuffer } from './BracketBuffer';
import type { ReasoningEnginePort, EngineContext, StreamHandlers, StreamResult, ExecuteResult } from '../ports/ReasoningEnginePort';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { PersistenceRepositoryPort } from '../ports/PersistenceRepositoryPort';
import type { ValidationService } from './ValidationService';

// Re-export the shared domain contracts so existing importers (worker.ts) keep
// resolving them from the engine module.
export type {
  EngineMetadata,
  EngineContext,
  StreamStatusEvent,
  StreamHandlers,
  StreamResult,
  ExecuteResult,
  CacheConfig,
  ReasoningEnginePort,
} from '../ports/ReasoningEnginePort';

export class ReasoningEngine implements ReasoningEnginePort {
  constructor(
    private promptBuilder: PromptBuilderPort,
    private cascade: LLMCascadePort,
    private validator: ValidationService,
    private cache?: PersistenceRepositoryPort
  ) {}

  /**
   * Passthrough so the orchestrator (worker.ts) can validate partial markdown on
   * browser-abort without reaching into the ValidationService directly.
   */
  validate12D(analysis: unknown, expectedCount?: number): boolean {
    return this.validator.validate12D(analysis, expectedCount);
  }

  /**
   * Execute the cascade with streaming. Emits delta + dimension fragments through
   * the supplied handlers. Falls through to the next model only if the current one
   * never produced a token (cold 429/error) — once tokens stream we commit.
   *
   * ADR 006: Uses BracketBuffer for programmatic JSON parsing (zero regex).
   * The BracketBuffer detects complete top-level JSON objects via bracket balancing
   * while respecting string literals and escape sequences.
   */
  async executeAndStream(
    context: EngineContext,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<StreamResult> {
    const systemPrompt = context.systemPrompt || await this.promptBuilder.build(context);
    const bracketBuffer = new BracketBuffer();

    const { started, finalText, modelUsed, finishReason, tokensUsed, costUsd, generationId } = await this.cascade.streamCascade(
      systemPrompt,
      (delta) => {
        // Raw delta for terminal/processing log
        handlers.onDelta(delta);
        // Parse JSON fragments via BracketBuffer (programmatic, zero regex)
        const fragments = bracketBuffer.feed(delta);
        fragments.forEach((frag) => handlers.onFragment(frag));
      },
      handlers.onStatus,
      signal
    );

    // Flush any remaining buffered JSON on stream end
    if (started || finalText) {
      const finalFragments = bracketBuffer.finalize();
      finalFragments.forEach((frag) => handlers.onFragment(frag));
    }

    return {
      finalText,
      modelUsed,
      finishReason,
      valid: this.validator.validate12D(finalText, context.dimensions?.length),
      produced: started,
      tokensUsed,
      costUsd,
      generationId,
    };
  }

  /**
   * Execute the cascade without streaming (legacy /analyze-llm). Cache-aside via
   * the persistence port when configured: returns cached markdown on hit, else runs
   * the cascade and writes the validated result back.
   */
  async execute(context: EngineContext): Promise<ExecuteResult> {
    const systemPrompt =
      context.systemPrompt || (await this.promptBuilder.build(context));

    // Cache-aside read
    let cacheKey: string | null = null;
    if (this.cache) {
      const promptHash = await this.cache.fingerprint(systemPrompt);
      cacheKey = this.cache.buildKey(
        promptHash,
        context.transcript.length,
        context.videoId || context.metadata.title
      );
      const cached = await this.cache.get(cacheKey);
      if (cached && this.validator.validate12D(cached)) {
        return { success: true, analysis: cached, model: 'cache-hit', cached: true, valid: true };
      }
    }

    // Cascade — preserve per-model retry-on-invalid via the accept predicate.
    const result = await this.cascade.runCascade(
      systemPrompt,
      context.transcript,
      context.metadata,
      (text) => this.validator.validate12D(text)
    );

    if (result) {
      if (this.cache && cacheKey) {
        await this.cache.set(cacheKey, result.text);
      }
      return { success: true, analysis: result.text, model: result.modelUsed, cached: false, valid: true };
    }

    console.error('[ReasoningEngine.execute] All models in cascade failed or validation failed', { videoId: context.videoId });
    Sentry.captureMessage('ReasoningEngine.execute: all cascade models failed or validation failed', {
      level: 'error',
      contexts: { reasoningEngine: { videoId: context.videoId } },
    });
    return { success: false, error: 'All models in cascade failed or validation failed' };
  }
}
