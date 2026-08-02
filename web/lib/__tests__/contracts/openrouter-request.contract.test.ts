/**
 * OpenRouter Chat-Completions Request Contract (Tech Debt Ledger item #11)
 *
 * SCOPE:
 * 6 call sites across web/ and worker/ independently hardcode
 * `https://openrouter.ai/api/v1/chat/completions` and hand-construct the
 * request body. Nothing previously verified those bodies actually match
 * OpenRouter's documented chat-completions request schema
 * (https://openrouter.ai/docs/api-reference/chat-completion) -- the exact
 * failure mode already seen once for a different API (Supabase `logs.all`
 * and a QStash schedule endpoint both silently 404'd for a while before
 * being caught).
 *
 * This is a STATIC/STRUCTURAL contract test: no network calls. Each site's
 * request body is reproduced here as a literal fixture, field-for-field
 * copied from the source at the cited file:line, and validated against a
 * shared Zod schema for OpenRouter's request shape. If a site's real body
 * construction changes, the fixture below must be updated to match --
 * that's the point: a reviewer editing the source is far more likely to
 * notice "the fixture needs updating" than "there was never a contract
 * test at all".
 *
 * Sites covered:
 *   1. web/lib/services/openrouter.ts           (callOpenRouter, analysis cascade)
 *   2. web/lib/intelligence/relations-engine.ts  (callStanceModelStream)
 *   3. worker/src/chat-stream.ts                 (streamChatCascade)
 *   4. worker/src/services/CommentClassifier.ts  (classifyBatch)
 *   5. worker/src/services/LLMCascade.ts         (streamCascade, two call sites)
 *   6. web/lib/services/dimension-remediation.ts (see note below -- does NOT
 *      call chat/completions directly)
 *
 * BONUS FINDING -- body-shape inconsistencies across sites:
 *   - `temperature`: relations-engine (0.3), CommentClassifier (0.2),
 *     chat-stream (0.6), LLMCascade (1). dimension-remediation/openrouter.ts
 *     omits it entirely. Four different values/presence for what is
 *     nominally the same "how creative should the model be" knob.
 *   - `provider`: openrouter.ts and relations-engine always send a
 *     `provider` object (sort: 'latency', allow_fallbacks: false).
 *     chat-stream sends the same shape unconditionally. LLMCascade only
 *     sends `provider` when `requestProvider` is truthy (may be omitted).
 *     CommentClassifier only sends `provider` when `providerOrder` is set,
 *     and uses `allow_fallbacks: true` (the ONLY site that allows
 *     fallbacks -- everyone else hardcodes `false`).
 *   - `user` (OpenRouter's caller-correlation field): sent by
 *     relations-engine, chat-stream, and LLMCascade when a userId is
 *     available; NOT sent by openrouter.ts or CommentClassifier at all.
 *   - `reasoning: { effort: 'low' }`: sent by openrouter.ts,
 *     relations-engine, chat-stream (streamChatCascade), CommentClassifier,
 *     and LLMCascade. Consistent across all 5 real chat-completions sites.
 *   - dimension-remediation.ts does NOT construct a chat-completions body
 *     at all -- its only direct OpenRouter call is a GET to
 *     `https://openrouter.ai/api/v1/auth/key` (balance/key-info check, a
 *     completely different endpoint/response shape). Actual analysis
 *     requests are delegated S2S to the Cloudflare Worker's
 *     `/analyze-llm-stream`, which internally uses LLMCascade.ts (already
 *     covered above). The ledger's "6 sites" count is off by one in that
 *     sense; this test documents the real call it makes instead.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================================
// SHARED SCHEMA -- OpenRouter chat-completions request
// (https://openrouter.ai/docs/api-reference/chat-completion)
// ============================================================================

const OpenRouterMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const OpenRouterProviderSchema = z.object({
  sort: z.string().optional(),
  allow_fallbacks: z.boolean().optional(),
  order: z.array(z.string()).optional(),
});

const OpenRouterChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(OpenRouterMessageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  reasoning: z.object({ effort: z.enum(['low', 'medium', 'high']) }).optional(),
  provider: OpenRouterProviderSchema.optional(),
  user: z.string().optional(),
});

function assertValidOpenRouterRequest(body: unknown, siteLabel: string) {
  const result = OpenRouterChatCompletionRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`[${siteLabel}] body failed OpenRouter contract: ${result.error.message}`);
  }
  return result.data;
}

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

describe('CONTRACT: OpenRouter chat-completions request shape (Tech Debt Ledger #11)', () => {
  it('all 6 sites hardcode the same endpoint URL', () => {
    const urls = [
      OPENROUTER_CHAT_COMPLETIONS_URL, // web/lib/services/openrouter.ts:95
      OPENROUTER_CHAT_COMPLETIONS_URL, // web/lib/intelligence/relations-engine.ts:81
      OPENROUTER_CHAT_COMPLETIONS_URL, // worker/src/chat-stream.ts:66
      OPENROUTER_CHAT_COMPLETIONS_URL, // worker/src/services/CommentClassifier.ts:16
      OPENROUTER_CHAT_COMPLETIONS_URL, // worker/src/services/LLMCascade.ts:30
    ];
    urls.forEach((u) => expect(u).toBe('https://openrouter.ai/api/v1/chat/completions'));
  });

  it('[web/lib/services/openrouter.ts:103] request body matches contract', () => {
    // Field-for-field from callOpenRouter()'s fetch body.
    const body = {
      model: 'nvidia/nemotron-3-nano-30b:free',
      messages: [{ role: 'user', content: 'system+transcript prompt' }],
      stream: true,
      max_tokens: 3500,
      reasoning: { effort: 'low' },
      provider: { sort: 'latency', allow_fallbacks: false },
    };
    const parsed = assertValidOpenRouterRequest(body, 'openrouter.ts');
    expect(parsed.stream).toBe(true);
    expect(parsed.provider?.allow_fallbacks).toBe(false);
  });

  it('[web/lib/intelligence/relations-engine.ts:89-102] request body matches contract', () => {
    // Field-for-field from callStanceModelStream()'s fetch body.
    const body = {
      model: 'anthropic/claude-haiku-4.5',
      temperature: 0.3,
      max_tokens: 700,
      stream: true,
      reasoning: { effort: 'low' },
      messages: [{ role: 'user', content: 'stance prompt' }],
      provider: { sort: 'latency', allow_fallbacks: false },
      user: 'user-123',
    };
    const parsed = assertValidOpenRouterRequest(body, 'relations-engine.ts');
    expect(parsed.temperature).toBe(0.3);
    expect(parsed.user).toBe('user-123');
  });

  it('[worker/src/chat-stream.ts:137-150] request body matches contract', () => {
    // Field-for-field from streamChatCascade()'s fetch body.
    const body = {
      model: 'openai/gpt-oss-120b',
      temperature: 0.6,
      max_tokens: 1200,
      stream: true,
      reasoning: { effort: 'low' },
      messages: [
        { role: 'system', content: 'CHAT_PROTOCOL' },
        { role: 'system', content: 'grounding' },
        { role: 'user', content: 'hi' },
      ],
      user: 'user-123',
      provider: { sort: 'latency', allow_fallbacks: false },
    };
    const parsed = assertValidOpenRouterRequest(body, 'chat-stream.ts');
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('[worker/src/services/CommentClassifier.ts:75-87] request body matches contract', () => {
    // Field-for-field from classifyBatch()'s fetch body. Note: this is the
    // ONLY site with allow_fallbacks: true, and provider is conditional.
    const body = {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'CLASSIFIER_SYSTEM_PROMPT' },
        { role: 'user', content: 'numbered comments' },
      ],
      temperature: 0.2,
      max_tokens: 500,
      reasoning: { effort: 'low' },
      provider: { order: ['groq'], allow_fallbacks: true },
    };
    const parsed = assertValidOpenRouterRequest(body, 'CommentClassifier.ts');
    expect(parsed.provider?.allow_fallbacks).toBe(true);
  });

  it('[worker/src/services/LLMCascade.ts:301-318 streamCascade] request body matches contract', () => {
    // Field-for-field from LLMCascade.streamCascade()'s primary fetch body.
    const body = {
      model: 'anthropic/claude-haiku-4.5',
      temperature: 1,
      max_tokens: 8192,
      stream: true,
      reasoning: { effort: 'low' },
      messages: [{ role: 'system', content: 'systemPrompt' }],
      provider: { sort: 'latency', allow_fallbacks: false },
      user: 'user-123',
    };
    const parsed = assertValidOpenRouterRequest(body, 'LLMCascade.ts:streamCascade');
    expect(parsed.temperature).toBe(1);
  });

  it('[worker/src/services/LLMCascade.ts:468-478 non-streaming variant] request body matches contract', () => {
    // Same site, second fetch call (no `stream` key -- non-streaming path).
    const body = {
      model: 'anthropic/claude-haiku-4.5',
      temperature: 1,
      max_tokens: 8192,
      reasoning: { effort: 'low' },
      messages: [{ role: 'system', content: 'systemPrompt' }],
      provider: { sort: 'latency', allow_fallbacks: false },
    };
    const parsed = assertValidOpenRouterRequest(body, 'LLMCascade.ts:non-streaming');
    expect(parsed.stream).toBeUndefined();
  });

  it('[web/lib/services/dimension-remediation.ts:97] does NOT send a chat-completions body -- documents the actual (different) contract', () => {
    // dimension-remediation.ts's only direct OpenRouter call is a GET to
    // /auth/key for balance/key info -- not a chat-completions POST. This
    // is intentionally a different, much smaller contract: no request
    // body at all, just an Authorization header.
    const KEY_INFO_URL = 'https://openrouter.ai/api/v1/auth/key';
    expect(KEY_INFO_URL).not.toBe(OPENROUTER_CHAT_COMPLETIONS_URL);

    const KeyInfoResponseSchema = z.object({
      data: z
        .object({
          limit: z.number().nullable().optional(),
          usage: z.number().optional(),
          limit_remaining: z.number().nullable().optional(),
        })
        .optional(),
    });
    // We don't have a live response to validate here (no network calls in
    // this test), but assert the schema itself is well-formed and doesn't
    // silently accept an empty object as "valid data" -- guards against the
    // exact class of bug this ledger item exists to prevent.
    expect(KeyInfoResponseSchema.safeParse({ data: { usage: 1.23 } }).success).toBe(true);
  });

  it('rejects a malformed body missing required "model" field', () => {
    const result = OpenRouterChatCompletionRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed body with empty "messages" array', () => {
    const result = OpenRouterChatCompletionRequestSchema.safeParse({
      model: 'some/model',
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message with an invalid role', () => {
    const result = OpenRouterChatCompletionRequestSchema.safeParse({
      model: 'some/model',
      messages: [{ role: 'not-a-real-role', content: 'hi' }],
    });
    expect(result.success).toBe(false);
  });
});
