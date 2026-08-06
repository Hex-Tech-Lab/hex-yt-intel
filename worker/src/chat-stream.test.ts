/**
 * CONTRACT: chat-stream.ts (streamChatCascade) hits the documented
 * OpenRouter chat-completions endpoint. Rewritten 2026-08-06: exported
 * streamChatCascade (small testability seam, was module-private) so this
 * test can mock global.fetch and call the REAL function, asserting the
 * real request body and real streamed-delta accumulation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCascade } from './chat-stream';

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

describe('streamChatCascade', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the real chat-completions endpoint with the real messages/model, and accumulates streamed deltas', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"provider":"groq","choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const result = await streamChatCascade(
      'test-api-key',
      'grounding text',
      [{ role: 'user', content: 'hi' }],
      (delta) => deltas.push(delta),
      undefined,
      [{ model: 'model/a', name: 'Model A' }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('model/a');
    expect(body.stream).toBe(true);
    expect(body.messages.some((message: any) => message.content === 'grounding text')).toBe(true);
    expect(deltas.join('')).toBe('Hello world');
    expect(result.content).toBe('Hello world');
    expect(result.servedByModel).toBe('model/a');
    expect(result.servedByProvider).toBe('groq');
  });

  it('falls through to the next cascade tier when the first model returns a non-2xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
      .mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}', 'data: [DONE]']));
    vi.stubGlobal('fetch', fetchMock);

    const result = await streamChatCascade(
      'test-api-key',
      '',
      [],
      () => {},
      undefined,
      [{ model: 'model/a', name: 'Model A' }, { model: 'model/b', name: 'Model B' }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.servedByModel).toBe('model/b');
    expect(result.content).toBe('fallback');
    expect(result.attempts).toEqual(['model/a', 'model/b']);
  });
});
