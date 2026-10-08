/**
 * See docs/reference/llm-cascade.md
 * qa-intel: no stream state here to call settleAnalysis or setError
 */

import * as Sentry from '@sentry/cloudflare';

import { translateModelId } from './model-id-translator';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { EngineMetadata, StreamStatusEvent } from '../ports/ReasoningEnginePort';

// 3-free + 1-paid model cascade – ordered best-first by a real latency+quality
// benchmark (2026-06-02) against the full v5.1 prompt. Under the ~55s request budget
// only ~1-2 attempts realistically complete, so tier 1 must be the proven performer.
//   - nemotron-3-nano-30b: ONLY free model that reliably produced valid 11-dim output
//     (3s first-token, 19-33s total). Lead model.
//   - gemini-2.0-flash: fast, sub-second TTFB, highly reliable.
//   - Claude Haiku 4.5: paid last resort (needs OpenRouter credit; 402 while overdrawn).
// NOTE: ":free" IDs need their providers enabled in the OpenRouter account allowlist
// or they 404 "no allowed providers". Paid IDs must NOT carry ":free".


const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const HTTP_REFERER = 'https://yt-intel.hex-tech-lab.workers.dev';

// Emergency fix 2026-07-25: was 62000 (a "for testing" bump from commit
// e18b82f, 2026-06-13, never reverted) -- broke every production analysis
// once account credits tightened, since 5 parallel streams x 62000 requested
// tokens each trips OpenRouter's per-request affordability check. 8192 is
// the pre-testing value. Registry-driven now (analysis.maxOutputTokens.haiku/
// .default) per the standing no-hardcoded-tunables directive -- these are
// ONLY the fallback for a stale client that didn't forward maxOutputTokens.

const LLM_HANDSHAKE_TIMEOUT_MS_FALLBACK = 15000;
const LLM_TIMEOUT_MS_FALLBACK = 240000;
const LLM_MAX_TOKENS_FALLBACK = { haiku: 8192, default: 16000 } as const;

// Fallback only, for a stale client that didn't forward llmCascadeTimeoutMs
// -- see CreateAnalysisUseCase's resolution of analysis.llmCascade.timeoutMs
// and this file's timeoutMs doc comment on streamCascade's callLLMStream
// call for the full RCA (was hardcoded to 120000, falsely assumed a 90s
// Cloudflare Worker platform ceiling that does not actually exist).
// Fallback only, for a stale client that didn't forward
// llmCascadeHandshakeTimeoutMs (analysis.llmCascade.handshakeTimeoutMs).


/**
 * Builds the OpenRouter `provider` request field. Extracted (real
 * duplication finding 2026-08-20, /simplify review) -- was identical
 * inline logic at both callLLMStream and callLLM, meaning any future
 * change to the fallback/allow_fallbacks behavior had to be made twice.
 *
 * ADR 041: the model-specific knowledge (which models require explicit
 * provider pinning) is stamped per tier by the registry-definition layer
 * (web/lib/config/cascade.ts#MODEL_CAPABILITIES) and forwarded on the
 * cascade item — no inline model-ID comparisons in dispatch code.
 */
function buildRequestProvider(
  requiresProviderOrder: boolean,
  providerOrder: string[] | undefined
): { order: string[]; allow_fallbacks: false } | undefined {
  if (requiresProviderOrder) {
    if (!providerOrder || providerOrder.length === 0) {
      throw new Error('LLMCascade SSOT Violation: Model requires explicit providerOrder from Settings Registry');
    }
    return {
      order: providerOrder,
      allow_fallbacks: false,
    };
  }
  return providerOrder && providerOrder.length > 0 ? { order: providerOrder, allow_fallbacks: false } : undefined;
}

/** Reasoning efforts this worker will ever request (see migration 20261008120000). */
const REASONING_EFFORTS = ['none', 'minimal', 'low'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Per-tier reasoning effort for this stream kind. The cascade reaches the
 * worker through the browser-relayed (not yet signed) request body, so any
 * value outside the cheap set -- or a missing one from an older client --
 * clamps to 'low', the historical hardcoded default.
 */
function tierReasoningEffort(
  tier: { reasoningGrounded?: string; reasoningProjective?: string },
  streamKind: 'grounded' | 'projective'
): ReasoningEffort {
  const raw = streamKind === 'projective' ? tier.reasoningProjective : tier.reasoningGrounded;
  return (REASONING_EFFORTS as readonly string[]).includes(raw ?? '') ? (raw as ReasoningEffort) : 'low';
}

/** OpenRouter `reasoning` request field: 'none' disables reasoning, otherwise an effort level. */
function buildReasoning(effort: ReasoningEffort): { enabled: false } | { effort: 'minimal' | 'low' } {
  return effort === 'none' ? { enabled: false } : { effort };
}

export class LLMCascade implements LLMCascadePort {
  private apiKey: string;
  // The ordered cascade actually used, forwarded from the client (resolved
  // from the Settings Registry web-side; the worker has no DB access per
  // ADR 005). Missing/empty cascade is a hard construction error — there is
  // no hardcoded chain fallback (removed; see constructor throw).
  private chain: ReadonlyArray<{ model: string; name: string; cost?: number; providerOrder?: string[]; maxOutputTokens?: number; requiresProviderOrder?: boolean; reasoningGrounded?: string; reasoningProjective?: string }>;
  private maxTokens: { haiku: number; default: number };
  private llmTimeoutMs: number;
  private llmHandshakeTimeoutMs: number;
  // Forwarded to OpenRouter's `user` field so requests are correlatable back
  // to a caller in OpenRouter's own activity dashboard (2026-07-30, security
  // correlation capability). Never used for authorization here -- Vercel
  // already authenticated/quota-gated the request before it reached this
  // worker. Undefined for background/system-triggered analyses with no
  // human caller (e.g. reaper retries) -- OpenRouter's field is optional.
  private userId?: string;
  // Prompt caching (2026-09-25): Anthropic prompt caching via OpenRouter
  // explicit cache_control breakpoints. Registry-resolved web-side
  // (analysis.promptCaching.enabled) and forwarded per-request -- the worker
  // has no DB access (ADR 005). Default true: the registry default is on, and
  // a stale client that doesn't forward the flag still benefits (write 1.25x
  // on bundle 1's shared ~19.2k-token prefix, reads 0.1x on bundles 2-5).
  private promptCachingEnabled: boolean;
  // Selects which stamped per-tier reasoning effort applies to this cascade's calls.
  private streamKind: 'grounded' | 'projective';
  // One-shot: a byte-identity breach is a caller contract bug, not transient.
  private byteIdentityWarningLogged = false;

  constructor(
    apiKey: string,
    models?: string[],
    cascade?: ReadonlyArray<{ model: string; name: string; cost?: number; providerOrder?: string[]; maxOutputTokens?: number; requiresProviderOrder?: boolean; reasoningGrounded?: string; reasoningProjective?: string }>,
    maxOutputTokens?: { haiku: number; default: number },
    userId?: string,
    llmTimeoutMs?: number,
    llmHandshakeTimeoutMs?: number,
    promptCachingEnabled?: boolean,
    streamKind: 'grounded' | 'projective' = 'grounded'
  ) {
    this.apiKey = apiKey;
    this.streamKind = streamKind;
    this.promptCachingEnabled = promptCachingEnabled !== false;
    this.llmHandshakeTimeoutMs = llmHandshakeTimeoutMs && llmHandshakeTimeoutMs > 0 ? llmHandshakeTimeoutMs : LLM_HANDSHAKE_TIMEOUT_MS_FALLBACK;
    this.maxTokens = maxOutputTokens ?? LLM_MAX_TOKENS_FALLBACK;
    this.userId = userId;
    this.llmTimeoutMs = llmTimeoutMs && llmTimeoutMs > 0 ? llmTimeoutMs : LLM_TIMEOUT_MS_FALLBACK;
    if (!cascade || cascade.length === 0) {
      throw new Error('LLMCascade SSOT Violation: Missing cascade configuration from Settings Registry');
    }
    // ADR 041 fail-fast (10X registry-enforcement mission): a structurally
    // invalid tier (blank model ID or display name) would otherwise ship as a
    // guaranteed OpenRouter 400 at stream time, after quota has already been
    // consumed. Throw at construction instead.
    for (const tier of cascade) {
      if (!tier || typeof tier.model !== 'string' || tier.model.trim().length === 0) {
        throw new Error('LLMCascade SSOT Violation: cascade tier with empty or missing model ID');
      }
      if (typeof tier.name !== 'string' || tier.name.trim().length === 0) {
        throw new Error(`LLMCascade SSOT Violation: cascade tier '${tier.model}' has empty or missing display name`);
      }
    }
    this.chain = cascade;
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
    signal?: AbortSignal,
    cacheSplit?: { prefix: string; suffix: string }
  ): Promise<{
    started: boolean;
    finalText: string;
    modelUsed: string;
    finishReason?: string;
    tokensUsed?: number;
    costUsd?: number;
    cachedTokens?: number;
    generationId?: string;
  }> {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let finalText = '';
    let modelUsed = '';
    let produced = false;
    let previousModel: string | null = null;
    let finishReason: string | undefined = undefined;
    let tokensUsed: number | undefined;
    let costUsd: number | undefined;
    let cachedTokens: number | undefined;
    let generationId: string | undefined;

    for (let tierIndex = 0; tierIndex < this.chain.length; tierIndex++) {
      const tier = this.chain[tierIndex];
      if (!tier) continue;
      const { model, name, providerOrder, maxOutputTokens, requiresProviderOrder } = tier;
      const reasoningEffort = tierReasoningEffort(tier, this.streamKind);

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
        this.llmTimeoutMs,
        signal,
        providerOrder as string[] | undefined,
        cacheSplit,
        maxOutputTokens,
        requiresProviderOrder,
        reasoningEffort
      );

      if (result.started && finalText && !result.error) {
        const durationMs = Date.now() - attemptStartTime;
        // skipcq: JS-0827
        console.log(`[LLMCascade] Stream ${streamId} succeeded with model=${name} durationMs=${durationMs} timestamp=${new Date().toISOString()}`);
        produced = true;
        finishReason = result.finishReason;
        tokensUsed = result.tokensUsed;
        costUsd = result.costUsd;
        cachedTokens = result.cachedTokens;
        generationId = result.generationId;
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
        const nextModel = this.chain[tierIndex + 1]?.name || 'unknown';
        // skipcq: JS-0827
        console.log(`[LLMCascade] Stream ${streamId} fallback from=${previousModel} to=${nextModel} reason=${classifiedError} timestamp=${new Date().toISOString()}`);
      }

      // skipcq: JS-0827
      console.warn(`[LLMCascade] Stream ${streamId} tier ${tierIndex} failed. Raw: ${rawError}, Classified: ${classifiedError}`);
      // Cascade fallbacks previously only reached console.log, which is not
      // queryable in Sentry -- "why did the primary model keep failing" was
      // unanswerable after the fact (confirmed 2026-07-23: a user-reported
      // pattern of frequent premium-tier fallback had zero matching Sentry
      // events despite the worker having Sentry available). captureMessage
      // (not captureException -- this is expected, handled cascade behavior,
      // not a crash) makes every fallback searchable by model/reason.
      Sentry.captureMessage(`LLMCascade fallback: ${name} -> tier ${tierIndex + 1}`, {
        level: 'warning',
        tags: { operation: 'llm-cascade-fallback', model: name, classifiedError },
        extra: { streamId, tierIndex, rawError, chainLength: this.chain.length },
      });
      // Owner-alert escalation (user directive 2026-09-27): credit/payment
      // exhaustion is NOT a routine fallback — it means every further model
      // in the cascade will also 402 (all require the same OpenRouter
      // balance) and the whole analysis is dead on arrival. Captured as
      // ERROR with a stable fingerprint-friendly message so it aggregates
      // into a single high-priority Sentry issue (owner email alerts fire
      // on high-priority issues). Deliberately generic to END USERS (the
      // stream error stays "All models in cascade failed") — the
      // advertising boundary is the owner's alerting, not the user UI.
      if (classifiedError === 'ERR_MONTHLY_QUOTA_EXHAUSTED') {
        Sentry.captureMessage('OpenRouter account out of credits — all paid models will 402 until topped up', {
          level: 'error',
          tags: { operation: 'llm-cascade-quota-exhausted', model: name },
          extra: { streamId, tierIndex, rawError },
        });
        console.error(`[LLMCascade] Stream ${streamId} OUT-OF-CREDITS: ${name} 402 — every paid model in the cascade will fail until the OpenRouter balance is topped up. Raw: ${rawError}`);
      }
      onStatus?.({ stage: 'fallback', from: name, error: classifiedError, rawError });
      previousModel = name;
    }

    return { started: produced, finalText, modelUsed, finishReason, tokensUsed, costUsd, cachedTokens, generationId };
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
    for (const tier of this.chain) {
      const { model, name, providerOrder, maxOutputTokens, requiresProviderOrder } = tier;
      const result = await this.callLLM(
        model,
        systemPrompt,
        transcript,
        metadata,
        45000,
        providerOrder as string[] | undefined,
        maxOutputTokens,
        requiresProviderOrder,
        tierReasoningEffort(tier, this.streamKind)
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
    timeoutMs: number,
    signal?: AbortSignal,
    providerOrder?: string[],
    cacheSplit?: { prefix: string; suffix: string },
    maxOutputTokens?: number,
    requiresProviderOrder?: boolean,
    reasoningEffort: ReasoningEffort = 'low'
  ): Promise<{ started: boolean; text: string; error?: string; finishReason?: string; tokensUsed?: number; costUsd?: number; cachedTokens?: number; generationId?: string }> {
    const controller = new AbortController();
    const handshakeTimer = setTimeout(() => {
      // skipcq: JS-0827
      console.warn(`[LLMCascade] Handshake timeout (${this.llmHandshakeTimeoutMs}ms exceeded) for model ${model}`);
      controller.abort();
    }, this.llmHandshakeTimeoutMs);
    const totalTimer = setTimeout(() => {
      // skipcq: JS-0827
      console.warn(`[LLMCascade] Total execution timeout (${timeoutMs}ms exceeded) for model ${model}`);
      controller.abort();
    }, timeoutMs);
    let text = '';
    let started = false;
    let finishReason: string | undefined;
    let tokensUsed: number | undefined;
    let costUsd: number | undefined;
    let cachedTokens: number | undefined;
    let generationId: string | undefined;
    let loggedProviderAttribution = false;

    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(handshakeTimer);
        clearTimeout(totalTimer);
        return { started: false, text: '', error: 'Request aborted' };
      }
      signal.addEventListener('abort', onAbort);
    }

    const requestModel = translateModelId(model);
    // ADR 041: the per-tier output cap is stamped by the registry-definition
    // layer (web/lib/config/cascade.ts, resolving analysis.maxOutputTokens.*)
    // and forwarded on the cascade item — no model-ID comparison here. The
    // constructor-level {haiku, default} fallback only applies to tiers that
    // carry no stamped cap (chat paths / stale clients).
    const requestMaxTokens = maxOutputTokens ?? this.maxTokens.default;
    // Prompt caching (2026-09-25): explicit Anthropic cache_control breakpoint
    // on the shared prefix block, per OpenRouter's documented per-block
    // pattern (works across all Anthropic-compatible providers incl.
    // Vertex/Bedrock). prefix + suffix === systemPrompt byte-for-byte
    // (PromptBuilder.buildSegmented contract), so message semantics are
    // unchanged -- same text, split into two blocks. Prefix must clear the
    // model's cacheable minimum (Haiku 4.5: 4096 tokens; our prefix is
    // ~19.2k, measured 2026-09-25). Non-Anthropic fallback tiers ignore
    // cache_control -- no behavior change there.
    // Byte-identity guard (2026-09-26): the 2-block cache split is only
    // semantically identical to the un-split prompt when
    // prefix + suffix === systemPrompt byte-for-byte (the
    // PromptBuilder.buildSegmented contract). If a caller ever passes a
    // split that fails that identity, sending the two blocks would CHANGE
    // the system prompt the model sees -- so fail soft: fall back to the
    // plain single-block message (cache benefit lost, semantics preserved)
    // and surface the contract breach to Sentry.
    const splitIsByteIdentical = cacheSplit ? cacheSplit.prefix + cacheSplit.suffix === systemPrompt : false;
    if (cacheSplit && !splitIsByteIdentical && !this.byteIdentityWarningLogged) {
      this.byteIdentityWarningLogged = true;
      Sentry.captureMessage('prompt-cache: cacheSplit fails byte-identity with systemPrompt; falling back to single-block system message', {
        level: 'warning',
        extra: {
          prefixLength: cacheSplit.prefix.length,
          suffixLength: cacheSplit.suffix.length,
          systemPromptLength: systemPrompt.length,
        },
      });
    }
    const systemMessages = cacheSplit && splitIsByteIdentical && this.promptCachingEnabled
      ? [{
          role: 'system',
          content: [
            { type: 'text', text: cacheSplit.prefix, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: cacheSplit.suffix },
          ],
        }]
      : [{ role: 'system', content: systemPrompt }];
    // RCA (2026-07-23): this used to unconditionally override `providerOrder`
    // with a hardcoded ['anthropic', 'google-vertex', 'amazon-bedrock'] for
    // ANY Haiku 4.5 tier, silently discarding the "Alternate Route"
    // cascade tier's own providerOrder (['google-vertex', 'amazon-bedrock'],
    // deliberately configured to skip the direct 'anthropic' provider). Net
    // effect: the primary tier and the "alternate route" tier sent the exact
    // same provider order to OpenRouter -- if 'anthropic' direct was down or
    // rate-limited, BOTH Haiku tiers failed for the identical reason instead
    // of the alternate tier actually routing through Vertex/Bedrock, and the
    // cascade fell straight through to the premium Sonnet 4.6 fallback on
    // every failure. Now respects each tier's own providerOrder when set,
    // only falling back to the full default order for the primary tier
    // (which has none).
    // RCA (2026-07-26): allow_fallbacks:true here let OpenRouter silently
    // substitute a different provider than the pinned providerOrder (e.g.
    // chat's Cerebras-first tier landing on a slower provider under the
    // hood -- "Unknown Provider" + inconsistent tok/s in the OpenRouter
    // dashboard was this, not a real outage). The cascade already provides
    // its own tier-to-tier fallback (Cerebras -> Groq -> Baseten -> ...), so
    // OpenRouter-level substitution is redundant and actively defeats
    // deliberate provider choice (e.g. paying more for Cerebras speed).
    const requestProvider = buildRequestProvider(requiresProviderOrder === true, providerOrder);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': 'vIntel - Synthesis Stream',
        },
        body: JSON.stringify({
          model: requestModel,
          temperature: 1,
          max_tokens: requestMaxTokens,
          stream: true,
          // Per-stream reasoning (2026-10-08): stamped per tier from the
          // analysis.reasoning.* registry keys -- off for grounded bundles,
          // 'low' for projective/combiner; defaults to the historical 'low'.
          reasoning: buildReasoning(reasoningEffort),
          // The system prompt (getUCISPrompt) already embeds the metadata + transcript
          // in its ACTIVE ANALYSIS SESSION block. Re-sending them here made the model
          // echo the prompt header instead of analyzing.
          messages: systemMessages,
          ...(requestProvider ? { provider: requestProvider } : {}),
          ...(this.userId ? { user: this.userId } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(handshakeTimer);

      if (!response.ok || !response.body) {
        clearTimeout(totalTimer);
        const errBody = await response.text().catch((fetchError) => {
          console.error('[LLMCascade] Error reading response body', fetchError);
          return '';
        });
        const truncatedBody = errBody.slice(0, 500);
        const errorMsg = `${response.status}: ${errBody.slice(0, 160)}`;
        // Non-2xx OpenRouter response was previously silently swallowed into
        // this return value with no telemetry anywhere -- if this rejected
        // every tier in a cascade (e.g. all 5 parallel bundle streams for one
        // analysis), the whole analysis fails with zero chunks and zero
        // trace in Sentry or anywhere else. RCA 2026-07-30 (video
        // ib74sLgjIBM): confirmed the `user` field itself isn't the cause
        // (live-tested against OpenRouter directly, succeeds), but this gap
        // means we still can't see WHY a provider/model tier got rejected.
        console.error('[LLMCascade.callLLMStream]', { model, requestModel, errorMsg });
        Sentry.captureMessage('LLMCascade.callLLMStream: OpenRouter non-2xx response', {
          level: 'error',
          contexts: { llmCascade: { model, requestModel, status: response.status, errBody: truncatedBody } },
        });
        return { started: false, text: '', error: errorMsg };
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
            const reason = json.choices?.[0]?.finish_reason;
            if (reason) finishReason = reason;

            // ADR 020 Phase 3: OpenRouter always includes a final SSE chunk
            // with `usage` (no `choices[].delta`) right before [DONE] on
            // streaming requests -- no request-side opt-in needed (the old
            // `usage: { include: true }` / `stream_options.include_usage`
            // request fields are deprecated no-ops, confirmed against
            // OpenRouter's usage-accounting docs 2026-08-01). `usage.cost`
            // is OpenRouter's actual billed USD (post cascade/free-tier
            // discounts), not a client-side token-count estimate.
            // Type-guarded, not a raw passthrough -- a malformed/missing
            // usage.cost from OpenRouter (e.g. null) would otherwise reach
            // the persist route's Zod schema (z.number().min(0).optional(),
            // which rejects null, only undefined) and fail the ENTIRE
            // persist call over a cost-telemetry glitch, losing the actual
            // analysis content. Better to silently drop just the cost data.
            if (json.usage) {
              if (typeof json.usage.total_tokens === 'number') tokensUsed = json.usage.total_tokens;
              if (typeof json.usage.cost === 'number') costUsd = json.usage.cost;
              // Prompt-caching accounting (2026-09-25): cache reads (and the
              // cache_write_tokens write marker) live under
              // prompt_tokens_details -- see OpenRouter's usage-accounting
              // docs. Persisted to analysis_chunks.cached_tokens so the
              // savings are measurable per analysis; a missing/zero value
              // simply means "not cached" and must never fail the stream.
              if (json.usage.prompt_tokens_details && typeof json.usage.prompt_tokens_details.cached_tokens === 'number') {
                cachedTokens = json.usage.prompt_tokens_details.cached_tokens;
              }
            }
            // Exact traceability: OpenRouter's own generation id, present on
            // every streamed chunk -- lets a future admin/billing dispute be
            // resolved against OpenRouter's own record instead of a
            // timestamp-based guess (2026-08-02 directive).
            if (typeof json.id === 'string' && !generationId) generationId = json.id;
            // Worker has no DB access (ADR 005) to check the
            // observability.logProviderAttribution setting live -- logs
            // unconditionally (console.log only, cheap, no Sentry volume).
            if (!loggedProviderAttribution && typeof json.provider === 'string') {
              loggedProviderAttribution = true;
              console.log(`[LLMCascade] Requested provider=${providerOrder?.[0] ?? 'default'} model=${model}, OpenRouter served via provider=${json.provider}`);
            }

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
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('ERR_MODEL_REFUSAL')) {
              throw err;
            }
            // ignore keep-alive / partial frames
          }
        }
      }
      clearTimeout(totalTimer);
      return { started, text, finishReason, tokensUsed, costUsd, cachedTokens, generationId };
    } catch (error) {
      clearTimeout(handshakeTimer);
      clearTimeout(totalTimer);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = message === 'The operation was aborted';
      console.error('[LLMCascade.callLLMStream]', { model, requestModel, message, isTimeout, timeoutMs });
      // Previously NOT captured to Sentry at all for a plain abort/timeout
      // (reasoning: "expected under normal cascade operation, pure noise at
      // volume") -- reversed 2026-08-07 per explicit user directive during
      // this project's stabilization phase: every abort/timeout must be
      // visible for RCA, full stop, even if that means more volume. A
      // captureException (not captureMessage) with `started`/timeoutMs/text
      // length in context, so a timeout that already produced partial
      // output (this session's actual live incident: bundle progress
      // visible client-side, zero dimensions ever persisted) is
      // distinguishable from one that never got any tokens at all.
      Sentry.captureException(error, {
        contexts: { llmCascade: { model, requestModel, isTimeout, timeoutMs, started, textLength: text.length } },
        tags: { operation: 'llm-cascade-timeout-or-abort', isTimeout: String(isTimeout) },
      });
      return { started, text, error: isTimeout ? 'Request timeout' : message, finishReason };
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
    providerOrder?: string[],
    maxOutputTokens?: number,
    requiresProviderOrder?: boolean,
    reasoningEffort: ReasoningEffort = 'low'
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const requestModel = translateModelId(model);
    // ADR 041: per-tier stamped cap, same mechanism as callLLMStream.
    const requestMaxTokens = maxOutputTokens ?? this.maxTokens.default;
    // Same tier-override bug as callLLMStream (see RCA there), plus this copy
    // additionally had wrong-cased provider slugs ('Amazon'/'Anthropic'/'Google')
    // -- OpenRouter provider slugs are lowercase ('anthropic', 'google-vertex',
    // 'amazon-bedrock'); with allow_fallbacks:false and no valid slugs, every
    // request through this path had no eligible provider at all.
    // Same allow_fallbacks fix as callLLMStream's requestProvider -- see RCA
    // there. OpenRouter-level provider substitution is redundant given the
    // cascade's own tier-to-tier fallback and defeats deliberate provider
    // pinning (e.g. Cerebras for chat speed).
    const requestProvider = buildRequestProvider(requiresProviderOrder === true, providerOrder);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': 'vIntel - Synthesis Stream',
        },
        body: JSON.stringify({
          model: requestModel,
          temperature: 1,
          max_tokens: requestMaxTokens,
          reasoning: buildReasoning(reasoningEffort),
          messages: [
            { role: 'system', content: systemPrompt },
          ],
          ...(requestProvider ? { provider: requestProvider } : {}),
          ...(this.userId ? { user: this.userId } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch((fetchError) => {
          console.error('[LLMCascade] Error reading response body', fetchError);
          return '';
        });
        const truncatedBody = errBody.slice(0, 500);
        const errorMsg = `${response.status}: ${errBody.slice(0, 200)}`;
        console.error('[LLMCascade.callLLM]', { model: requestModel, errorMsg });
        Sentry.captureMessage('LLMCascade.callLLM: OpenRouter non-2xx response', {
          level: 'error',
          contexts: { llmCascade: { model: requestModel, status: response.status, errBody: truncatedBody } },
        });
        return { success: false, error: errorMsg };
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        console.error('[LLMCascade.callLLM] Empty response from LLM', { model: requestModel });
        Sentry.captureMessage('LLMCascade.callLLM: Empty response from LLM', {
          level: 'error',
          contexts: { llmCascade: { model: requestModel } },
        });
        return { success: false, error: 'Empty response from LLM' };
      }

      return { success: true, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = message === 'The operation was aborted';
      console.error('[LLMCascade.callLLM]', { model: requestModel, message, isTimeout, timeoutMs });
      // Same reversal as callLLMStream's catch block above -- every
      // abort/timeout captured, not just non-timeout throws (2026-08-07).
      Sentry.captureException(error, {
        contexts: { llmCascade: { model: requestModel, isTimeout, timeoutMs } },
        tags: { operation: 'llm-cascade-timeout-or-abort', isTimeout: String(isTimeout) },
      });
      return { success: false, error: isTimeout ? 'Request timeout' : message };
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

// qa-intel: no stream state here to call settleAnalysis or setError




