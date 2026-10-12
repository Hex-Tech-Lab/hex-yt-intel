// T22: a non-2xx reply that falls through to the next provider must reach Sentry.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCascade } from '../chat-stream';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/cloudflare', () => ({ captureMessage, captureException: vi.fn() }));

const sse = (text: string) =>
  new Response(`data: ${JSON.stringify({ provider: 'Groq', choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });

describe('streamChatCascade fallback visibility', () => {
  afterEach(() => { vi.unstubAllGlobals(); captureMessage.mockReset(); });

  it('reports a 429 on Cerebras before serving from Groq', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
      .mockResolvedValueOnce(sse('hi')));
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
      { model: 'openai/gpt-oss-120b', name: 'g', providerOrder: ['groq'] },
    ]);
    expect(result.content).toBe('hi');
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]?.[1]?.tags).toMatchObject({ reason: 'http_429', provider: 'cerebras' });
  });

  it('keeps a partial answer instead of appending a second model after a mid-stream failure', async () => {
    const enc = new TextEncoder();
    const broken = new ReadableStream<Uint8Array>({
      // First read delivers a delta, the second fails (erroring in start() would drop the queued chunk).
      pulls: 0,
      pull(controller) {
        if (this.pulls++ === 0) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'part' } }] })}\n\n`));
        else controller.error(new Error('connection reset'));
      },
    });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(broken, { status: 200 }))
      .mockResolvedValueOnce(sse('second answer'));
    vi.stubGlobal('fetch', fetchSpy);
    const deltas: string[] = [];
    const result = await streamChatCascade('k', 'g', [], (d) => deltas.push(d), undefined, [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
      { model: 'openai/gpt-oss-120b', name: 'g', providerOrder: ['groq'] },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(deltas.join('')).toBe('part');
    expect(result.content).toBe('part');
    expect(captureMessage.mock.calls[0]?.[1]?.extra).toMatchObject({ midStream: true });
  });
});
