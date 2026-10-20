/**
 * CONTRACT: LLMCascade hits the documented OpenRouter chat-completions
 * endpoint. Rewritten 2026-08-06: mocks global.fetch with a real
 * SSE-shaped ReadableStream, instantiates the real LLMCascade, calls the
 * real streamCascade(), asserts the real request body and real
 * onDelta/onStatus streaming behavior.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMCascade } from './LLMCascade';

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

describe('LLMCascade.streamCascade', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the real chat-completions endpoint with the real system prompt/model, and streams real deltas to onDelta', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"part1"}}],"id":"gen-1"}',
        'data: {"choices":[{"delta":{"content":"part2"}},{"finish_reason":"stop"}]}',
        'data: [DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'model/a', name: 'Model A' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);
    const deltas: string[] = [];
    const statuses: string[] = [];

    const result = await cascade.streamCascade(
      'system prompt text',
      (delta) => deltas.push(delta),
      (status) => statuses.push(status.stage),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('model/a');
    expect(body.stream).toBe(true);
    expect(body.messages.some((message: any) => message.content === 'system prompt text')).toBe(true);

    expect(deltas.join('')).toBe('part1part2');
    expect(result.started).toBe(true);
    expect(result.finalText).toBe('part1part2');
    expect(result.modelUsed).toBe('Model A');
    expect(statuses).toContain('model');
  });

  it('falls through to the next tier when the first model produces no tokens, emitting a fallback status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => 'server error' } as Response)
      .mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"recovered"}}]}', 'data: [DONE]']));
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'model/a', name: 'Model A' }, { model: 'model/b', name: 'Model B' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);
    const statuses: string[] = [];

    const result = await cascade.streamCascade('sys', () => {}, (status) => statuses.push(status.stage));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.modelUsed).toBe('Model B');
    expect(result.finalText).toBe('recovered');
    expect(statuses).toContain('fallback');
  });

  // Issue #241: LLMCascade.ts previously ignored the forwarded `cascade` field's
  // per-tier providerOrder and always substituted its own hardcoded
  // multi-provider default literal (missing the tier's provider entirely) -- a
  // third, independently-drifting source of truth alongside
  // web/lib/config/cascade.ts and the `cascade.analysis` Settings Registry
  // key. These tests prove the forwarded value from the `cascade` constructor
  // arg (the payload field populated end-to-end from CreateAnalysisUseCase's
  // resolveAnalysisCascade()) is what actually reaches OpenRouter, and that
  // the provider pinning guard is driven by the tier's stamped
  // requiresProviderOrder capability (ADR 041), never by an inline model-ID
  // comparison.
  it('uses the forwarded per-tier providerOrder for a tier that requires it, not the hardcoded default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'test/model-a', name: 'Model A (Azure)', providerOrder: ['azure'], requiresProviderOrder: true }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);

    await cascade.streamCascade('sys', () => {}, () => {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Forwarded single-provider order must win outright -- not merged with,
    // or replaced by, the hardcoded multi-provider default.
    expect(body.provider).toEqual({ order: ['azure'], allow_fallbacks: false });
  });

  it('fails closed when a tier requires providerOrder but has none at all', async () => {
    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'test/model-a', name: 'Model A (no providerOrder)', requiresProviderOrder: true }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);

    // Attempting to stream should throw because buildRequestProvider fails
    await expect(cascade.streamCascade('sys', vi.fn())).rejects.toThrow('LLMCascade SSOT Violation: Model requires explicit providerOrder from Settings Registry');
  });
});

describe('LLMCascade per-stream reasoning effort (analysis.reasoning.*)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function requestBodyFor(
    tier: { model: string; name: string; reasoningGrounded?: string; reasoningProjective?: string },
    streamKind?: 'grounded' | 'projective',
  ): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cascade = new LLMCascade('k', undefined, [tier], { haiku: 8192, default: 16000 }, 'u', 240000, 15000, true, streamKind);
    await cascade.streamCascade('prompt', () => undefined);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  const tier = { model: 'model/a', name: 'A', reasoningGrounded: 'none', reasoningProjective: 'low' };

  it('disables reasoning for grounded streams', async () => {
    expect((await requestBodyFor(tier, 'grounded')).reasoning).toEqual({ enabled: false });
  });

  it('requests low effort for projective streams', async () => {
    expect((await requestBodyFor(tier, 'projective')).reasoning).toEqual({ effort: 'low' });
  });

  it('defaults to the historical low effort when the tier carries no stamp (older client)', async () => {
    expect((await requestBodyFor({ model: 'model/a', name: 'A' })).reasoning).toEqual({ effort: 'low' });
  });

  it('clamps an out-of-set (tampered) effort to low instead of forwarding it', async () => {
    expect((await requestBodyFor({ model: 'model/a', name: 'A', reasoningGrounded: 'max' }, 'grounded')).reasoning).toEqual({ effort: 'low' });
  });
});

describe('LLMCascade.generateStream (Phase C engines)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('streams the cascade output as text and sends system + user prompt together', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"{\\"claims\\":"}}]}', 'data: {"choices":[{"delta":{"content":"[]}"}}]}', 'data: [DONE]']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cascade = new LLMCascade('k', undefined, [{ model: 'model/a', name: 'A' }], { haiku: 8192, default: 16000 }, 'u', 240000, 15000);
    const stream = await cascade.generateStream({ systemPrompt: 'SYS', userPrompt: 'USER' });
    const reader = stream.getReader();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
    }
    expect(text).toBe('{"claims":[]}');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(JSON.stringify(body.messages)).toContain('SYS');
    expect(JSON.stringify(body.messages)).toContain('USER');
  });

  it('errors the stream when no tier produces output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const cascade = new LLMCascade('k', undefined, [{ model: 'model/a', name: 'A' }], { haiku: 8192, default: 16000 }, 'u', 240000, 15000);
    const stream = await cascade.generateStream({ systemPrompt: 'SYS', userPrompt: '' });
    await expect(stream.getReader().read()).rejects.toThrow(/no tier produced output/);
  });
});
