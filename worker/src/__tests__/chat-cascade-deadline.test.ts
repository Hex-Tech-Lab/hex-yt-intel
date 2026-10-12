// Cumulative cascade deadline, client-abort propagation, in-band stream error classification.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCascade } from '../chat-stream';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/cloudflare', () => ({ captureMessage, captureException: vi.fn() }));

const CASCADE = [
  { model: 'openai/gpt-oss-120b', name: 'a', providerOrder: ['cerebras'] },
  { model: 'openai/gpt-oss-120b', name: 'b', providerOrder: ['groq'] },
];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const sse = (text: string) => new Response(`${delta(text)}data: [DONE]\n\n`, { status: 200 });

/** Body that yields `first` then hangs until the request signal aborts (like a real fetch body). */
function hangingBody(first: string, signal: AbortSignal | null | undefined): Response {
  const enc = new TextEncoder();
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(enc.encode(delta(first)));
        return;
      }
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          controller.error(signal.reason);
          reject(signal.reason);
        }, { once: true });
      }).catch(() => undefined);
    },
  });
  return new Response(body, { status: 200 });
}

describe('streamChatCascade deadline, abort, and in-band error handling', () => {
  afterEach(() => { vi.unstubAllGlobals(); captureMessage.mockReset(); });

  it('(a) client abort mid-stream aborts the current fetch and starts no next model', async () => {
    const client = new AbortController();
    const fetchSpy = vi.fn((_url: string, init: RequestInit) => Promise.resolve(hangingBody('part', init.signal)));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => { client.abort(); }, undefined, CASCADE, undefined, 5000, client.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.content).toBe('part');
    expect(result.outcome).toBe('client_abort');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('(a2) a client that is already gone never starts a fallback model', async () => {
    const client = new AbortController();
    client.abort();
    const fetchSpy = vi.fn(() => Promise.resolve(sse('should not run')));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, CASCADE, undefined, 5000, client.signal);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(result.outcome).toBe('client_abort');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('(a3) abort before any text: no fallback model, no Sentry, outcome client_abort', async () => {
    const client = new AbortController();
    const fetchSpy = vi.fn((_url: string, init: RequestInit) => {
      setTimeout(() => client.abort(), 20); // after the reader is waiting on the body
      return Promise.resolve(hangingBody('', init.signal));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, CASCADE, undefined, 5000, client.signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('client_abort');
    expect(result.content).toBe('');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('(a4) a real network error in the same window as a disconnect is still reported', async () => {
    const client = new AbortController();
    const fetchSpy = vi.fn(() => {
      client.abort();
      return Promise.reject(new TypeError('network connection lost'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    await streamChatCascade('k', 'g', [], () => {}, undefined, CASCADE, undefined, 5000, client.signal);
    expect(captureMessage.mock.calls.some((c) => c[1]?.tags?.reason === 'error')).toBe(true);
  });

  it('(b) fallback models share one budget: second model gets the remaining time, cascade stops when spent', async () => {
    const budgetCascade = [
      ...CASCADE,
      { model: 'openai/gpt-oss-120b', name: 'c', providerOrder: ['together'] },
    ];
    let call = 0;
    const fetchSpy = vi.fn((_url: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        // First model fails with a 429 after 200ms, consuming most of the 300ms budget.
        return sleep(200).then(() => new Response('rate limited', { status: 429 }));
      }
      return Promise.resolve(hangingBody('', init.signal));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, budgetCascade, undefined, 300);
    // Without a shared budget the second model would get a fresh 300ms (total ~500ms) and the third would run.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('');
    expect(result.outcome).toBe('budget_spent');
    expect(captureMessage.mock.calls.filter((c) => c[1]?.tags?.operation === 'chat-cascade-budget-exhausted')).toHaveLength(1);
    // The timed-out attempt is covered by the budget event, not a second per-model timeout report.
    expect(captureMessage.mock.calls.filter((c) => c[1]?.tags?.reason === 'timeout')).toHaveLength(0);
  });

  it('(c) text chunk then in-band error chunk => partial, one fetch, reason stream_error', async () => {
    const body = `${delta('part')}data: ${JSON.stringify({ error: { message: 'upstream died' }, choices: [{ finish_reason: 'error', delta: { content: '' } }] })}\n\n`;
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(body, { status: 200 })).mockResolvedValueOnce(sse('second'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, CASCADE);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.partial).toBe(true);
    expect(result.content).toBe('part');
    expect(captureMessage.mock.calls[0]?.[1]?.tags).toMatchObject({ reason: 'stream_error' });
  });

  it('(d) in-band error before any text => next model tried, reason stream_error', async () => {
    const errorOnly = `data: ${JSON.stringify({ error: { message: 'overloaded' }, choices: [{ finish_reason: 'error', delta: {} }] })}\n\n`;
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(errorOnly, { status: 200 })).mockResolvedValueOnce(sse('recovered'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await streamChatCascade('k', 'g', [], () => {}, undefined, CASCADE);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('recovered');
    expect(result.partial).toBe(false);
    expect(captureMessage.mock.calls[0]?.[1]?.tags).toMatchObject({ reason: 'stream_error' });
  });
});
