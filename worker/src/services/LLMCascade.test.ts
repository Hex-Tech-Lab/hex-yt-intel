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

    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'model/a', name: 'Model A' }]);
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

    const cascade = new LLMCascade('test-api-key', undefined, [
      { model: 'model/a', name: 'Model A' },
      { model: 'model/b', name: 'Model B' },
    ]);
    const statuses: string[] = [];

    const result = await cascade.streamCascade('sys', () => {}, (status) => statuses.push(status.stage));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.modelUsed).toBe('Model B');
    expect(result.finalText).toBe('recovered');
    expect(statuses).toContain('fallback');
  });

  // Issue #241: LLMCascade.ts previously ignored the forwarded `cascade` field's
  // per-tier providerOrder for claude-haiku-4.5 tiers and always substituted its
  // own hardcoded ['anthropic', 'google-vertex', 'amazon-bedrock'] literal
  // (missing 'azure' entirely) -- a third, independently-drifting source of
  // truth alongside web/lib/config/cascade.ts and the `cascade.analysis`
  // Settings Registry key. These tests prove the forwarded value from the
  // `cascade` constructor arg (the payload field populated end-to-end from
  // CreateAnalysisUseCase's resolveAnalysisCascade()) is what actually reaches
  // OpenRouter, and that the hardcoded literal is used only as a defensive
  // fallback when a tier genuinely carries no providerOrder.
  it('uses the forwarded per-tier providerOrder for a claude-haiku-4.5 tier, not the hardcoded default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, [
      {
        model: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5 (Azure)',
        providerOrder: ['azure'],
      },
    ]);

    await cascade.streamCascade('sys', () => {}, () => {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Forwarded single-provider order must win outright -- not merged with,
    // or replaced by, the hardcoded multi-provider default.
    expect(body.provider).toEqual({ order: ['azure'], allow_fallbacks: false });
  });

  it('falls back to the hardcoded default provider order (including azure) when a claude-haiku-4.5 tier has no providerOrder at all', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cascade = new LLMCascade('test-api-key', undefined, [
      { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (no providerOrder)' },
    ]);

    await cascade.streamCascade('sys', () => {}, () => {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.provider.allow_fallbacks).toBe(false);
    expect(body.provider.order).toContain('azure');
    expect(body.provider.order).toEqual(['google-vertex', 'azure', 'anthropic', 'amazon-bedrock']);
  });
});
