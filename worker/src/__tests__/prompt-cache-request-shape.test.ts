/**
 * Prompt caching for the 5 bundle LLM calls (2026-09-25).
 *
 * CONTRACT: when PromptBuilder segments the prompt, the 5 bundle calls share a
 * byte-identical prefix (UCIS core + metadata + transcript -- the
 * cache-control breakpoint target), and LLMCascade places the Anthropic
 * `cache_control: { type: 'ephemeral' }` breakpoint on that prefix block with
 * the bundle-specific instruction left uncached after it. Request semantics
 * are otherwise unchanged (prefix + suffix === the pre-split system prompt),
 * and usage.prompt_tokens_details.cached_tokens is captured for
 * analysis_chunks.cached_tokens accounting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMCascade } from '../services/LLMCascade';
import { PromptBuilder } from '../services/PromptBuilder';
import type { EngineContext } from '../ports/ReasoningEnginePort';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

// Final chunk carries usage with prompt_tokens_details -- OpenRouter's
// documented streaming usage shape (ADR 020 Phase 3 comment in LLMCascade).
function cacheSseResponse(cachedTokens: number): Response {
  return sseResponse([
    'data: {"choices":[{"delta":{"content":"analysis content delta here"}}]}',
    `data: {"choices":[{}],"usage":{"total_tokens":20000,"cost":0.05,"prompt_tokens_details":{"cached_tokens":${cachedTokens},"cache_write_tokens":0}}}`,
    'data: [DONE]',
  ]);
}

const HAIKU_CHAIN = [{ model: 'anthropic/claude-haiku-4.5', name: 'Haiku 4.5', providerOrder: ['anthropic'] }];

function baseContext(dimensions: number[]): EngineContext {
  return {
    metadata: {
      title: 'Test Video',
      channelTitle: 'Test Channel',
      viewCount: '1000',
      likeCount: '10',
      commentCount: '5',
      publishedAt: '2026-01-01',
      duration: 600,
    },
    transcript: 'line one. line two.',
    persona: 'creator',
    timezone: 'UTC',
    dimensions,
  } as unknown as EngineContext;
}

// The real 5-bundle shape: every bundle's shared prefix must be byte-identical
// so the cache breakpoint hits across all 5 calls.
const BUNDLE_DIMENSIONS: number[][] = [[1, 2, 3], [4, 5], [6], [7, 8], [9, 10, 11]];

describe('prompt-cache request shape (bundle LLM calls)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PromptBuilder produces a byte-identical sharedPrefix across all 5 bundles, and prefix+suffix === build()', async () => {
    const builder = new PromptBuilder(undefined);
    const built: Array<{ sharedPrefix: string; segmentInstruction: string }> = [];
    for (const dims of BUNDLE_DIMENSIONS) {
      built.push(await builder.buildSegmented({ ...baseContext(dims), dimensions: dims }));
    }
    const prefixes = new Set(built.map((b) => b.sharedPrefix));
    expect(prefixes.size).toBe(1);

    for (let i = 0; i < BUNDLE_DIMENSIONS.length; i++) {
      const full = await builder.build({ ...baseContext(BUNDLE_DIMENSIONS[i]!), dimensions: BUNDLE_DIMENSIONS[i] });
      expect(built[i]!.sharedPrefix + built[i]!.segmentInstruction).toBe(full);
      // The bundle-specific part is AFTER the breakpoint and differs per bundle.
      expect(built[i]!.segmentInstruction).toContain(`CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS`);
    }
    // Bundles actually differ after the breakpoint (not accidentally identical).
    expect(new Set(built.map((b) => b.segmentInstruction)).size).toBe(BUNDLE_DIMENSIONS.length);
  });

  it('places cache_control on the prefix block and leaves the suffix uncached; captures cached_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cacheSseResponse(19000));
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, HAIKU_CHAIN, { haiku: 8192, default: 16000 }, 'user1', 240000, 15000, true);
    const prefix = 'SHARED PREFIX TEXT';
    const suffix = '\n---\nBUNDLE SPECIFIC INSTRUCTIONS';
    const result = await cascade.streamCascade(prefix + suffix, () => {}, undefined, undefined, { prefix, suffix });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(1);
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } });
    expect(content[1]).toEqual({ type: 'text', text: suffix });
    // Byte-identity contract with the un-split prompt.
    expect(content[0].text + content[1].text).toBe(prefix + suffix);
    expect(result.cachedTokens).toBe(19000);
  });

  it('sends a plain single-block system message when caching is disabled (registry kill switch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cacheSseResponse(0));
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, HAIKU_CHAIN, { haiku: 8192, default: 16000 }, 'user1', 240000, 15000, false);
    const prefix = 'SHARED PREFIX TEXT';
    const suffix = '\n---\nBUNDLE SPECIFIC INSTRUCTIONS';
    await cascade.streamCascade(prefix + suffix, () => {}, undefined, undefined, { prefix, suffix });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toBe(prefix + suffix);
  });

  it('defaults to caching enabled for stale clients that do not forward the flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cacheSseResponse(19000));
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, HAIKU_CHAIN, { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);
    const prefix = 'P';
    const suffix = 'S';
    await cascade.streamCascade(prefix + suffix, () => {}, undefined, undefined, { prefix, suffix });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  // End-to-end integration assertion (2026-09-26, PR #348 review): the REAL
  // PromptBuilder segmentation flowing through the REAL LLMCascade request
  // shape -- the system message must be a 2-block array with cache_control
  // exactly on the prefix block (never the suffix), and the concatenation of
  // the two blocks must be byte-for-byte identical to the un-split prompt
  // (ReasoningEngine's systemPrompt = sharedPrefix + segmentInstruction).
  it('real PromptBuilder -> LLMCascade request: 2-block system array, cache_control on prefix only, byte-for-byte split', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cacheSseResponse(19000));
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, HAIKU_CHAIN, { haiku: 8192, default: 16000 }, 'user1', 240000, 15000, true);
    const builder = new PromptBuilder(undefined);

    for (const dims of BUNDLE_DIMENSIONS) {
      const context = baseContext(dims);
      const segmented = await builder.buildSegmented({ ...context, dimensions: dims });
      const full = await builder.build({ ...context, dimensions: dims });
      const split = { prefix: segmented.sharedPrefix, suffix: segmented.segmentInstruction };
      await cascade.streamCascade(split.prefix + split.suffix, () => {}, undefined, undefined, split);

      const body = JSON.parse((fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit])[1].body as string);
      const message = body.messages[0];
      expect(message.role).toBe('system');
      // Exactly a 2-block array: prefix + suffix, nothing else.
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);
      // cache_control sits exactly on the prefix block and nowhere else.
      expect(message.content[0]).toEqual({ type: 'text', text: segmented.sharedPrefix, cache_control: { type: 'ephemeral' } });
      expect(message.content[1]).toEqual({ type: 'text', text: segmented.segmentInstruction });
      expect(message.content[1].cache_control).toBeUndefined();
      // Byte-for-byte identity with the un-split prompt.
      expect(message.content[0].text + message.content[1].text).toBe(full);
      expect(body.messages[0].content[0].text).toBe(segmented.sharedPrefix);
    }

    // Every bundle's actual request carried the byte-identical prefix.
    const requestedPrefixes = new Set(
      (fetchMock.mock.calls as Array<[string, RequestInit]>).map(([, init]) => {
        const requestBody = JSON.parse(init.body as string);
        return requestBody.messages[0].content[0].text;
      })
    );
    expect(requestedPrefixes.size).toBe(1);
  });
});