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
    const result = await streamChatCascade({ apiKey: 'k', grounding: 'g', history: [], onDelta: () => {}, cascade: [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
      { model: 'openai/gpt-oss-120b', name: 'g', providerOrder: ['groq'] },
    ] });
    expect(result.content).toBe('hi');
    expect(result.partial).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]?.[1]?.tags).toMatchObject({ reason: 'http_429', provider: 'cerebras' });
  });

  it('keeps a partial answer instead of appending a second model after a mid-stream failure', async () => {
    const enc = new TextEncoder();
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>({
      // First read delivers a delta, the second fails (erroring in start() would drop the queued chunk).
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'part' } }] })}\n\n`));
        else controller.error(new Error('connection reset'));
      },
    });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(broken, { status: 200 }))
      .mockResolvedValueOnce(sse('second answer'));
    vi.stubGlobal('fetch', fetchSpy);
    const deltas: string[] = [];
    const result = await streamChatCascade({ apiKey: 'k', grounding: 'g', history: [], onDelta: (chunk) => deltas.push(chunk), cascade: [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
      { model: 'openai/gpt-oss-120b', name: 'g', providerOrder: ['groq'] },
    ] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(deltas.join('')).toBe('part');
    expect(result.content).toBe('part');
    expect(result.partial).toBe(true);
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({ level: 'error', tags: { operation: 'chat-cascade-partial', reason: 'error' } });
  });

  it('treats an in-stream OpenRouter error chunk as a partial failure', async () => {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'part' } }] })}\n\n`
      + `data: ${JSON.stringify({ error: { message: 'upstream died' }, choices: [{ finish_reason: 'error', delta: { content: '' } }] })}\n\n`;
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(sse('second answer'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade({ apiKey: 'k', grounding: 'g', history: [], onDelta: () => {}, cascade: [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
      { model: 'openai/gpt-oss-120b', name: 'g', providerOrder: ['groq'] },
    ] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('part');
    expect(result.partial).toBe(true);
  });

  it('labels a non-deadline AbortError as cancelled, never as a timeout', async () => {
    const enc = new TextEncoder();
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'part' } }] })}\n\n`));
        else controller.error(new DOMException('cancelled', 'AbortError'));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(broken, { status: 200 })));
    await streamChatCascade({ apiKey: 'k', grounding: 'g', history: [], onDelta: () => {}, cascade: [
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['cerebras'] },
    ] });
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({ tags: { reason: 'cancelled' } });
    expect(captureMessage.mock.calls[0]?.[1]?.tags?.reason).not.toBe('timeout');
  });

  it('labels a TimeoutError with custom timeoutMs in log/sentry', async () => {
    const enc = new TextEncoder();
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'writing piece' } }] })}\n\n`));
        else controller.error(new DOMException('deadline passed', 'TimeoutError'));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(broken, { status: 200 })));
    const result = await streamChatCascade({ apiKey: 'k', grounding: 'g', history: [], onDelta: () => {}, cascade: [
      { model: 'anthropic/claude-haiku-5.5', name: 'h' },
    ], userId: 'user-1', timeoutMs: 90000 });
    expect(result.partial).toBe(true);
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({
      level: 'error',
      tags: { operation: 'chat-cascade-partial', reason: 'timeout' },
    });
  });
});
