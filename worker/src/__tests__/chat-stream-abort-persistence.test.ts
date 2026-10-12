// Handler-level tests for chat stream persistence under client_abort scenarios.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleChatStream } from '../chat-stream';
import { chatPayloadDigest, chatTokenMessage } from '../../../web/lib/utils/chat-payload-digest';

vi.mock('@sentry/cloudflare', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const SECRET = 'test-secret';
const enc = new TextEncoder();

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const base = {
  conversationId: 'conv-test-abort',
  userId: 'user-test-abort',
  requestId: 'req-test-abort',
  tier: 'pro',
  grounding: 'Only talk about this video.',
  history: [{ role: 'user', content: 'What is this video about?' }],
  models: ['openai/gpt-oss-120b'],
  cascade: [{ model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', providerOrder: ['cerebras'] }],
  appUrl: 'https://test.getvintel.com',
};

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function hangingBody(first: string, signal: AbortSignal | null | undefined): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        if (first) {
          controller.enqueue(enc.encode(delta(first)));
        }
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

function createContext(body: Record<string, unknown>, clientSignal: AbortSignal, waitUntilPromises: Promise<unknown>[]) {
  return {
    req: {
      json: () => Promise.resolve(body),
      raw: {
        signal: clientSignal,
      } as unknown as Request,
    },
    env: {
      STREAM_HMAC_SECRET: SECRET,
      OPENROUTER_API_KEY: 'mock-openrouter-key',
      APP_URL: 'https://test.getvintel.com',
      ALLOWED_APP_ORIGINS: 'https://test.getvintel.com',
      ENVIRONMENT: 'production',
    },
    json: (responseBody: unknown, status: number) => new Response(JSON.stringify(responseBody), { status }),
    executionCtx: {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    },
  } as unknown as Parameters<typeof handleChatStream>[0];
}

async function drainResponse(res: Response): Promise<string> {
  return await res.text();
}

describe('chat-stream client_abort handler-level persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('EMPTY ABORT: request signal aborts before the first delta -> /persist fetch is never called with assistant content', async () => {
    const clientController = new AbortController();
    const waitUntilPromises: Promise<unknown>[] = [];

    const persistFetchSpy = vi.fn();
    const fetchSpy = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
      if (urlStr.includes('/api/chat/persist')) {
        persistFetchSpy(urlStr, init);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (urlStr.includes('openrouter.ai')) {
        // Abort before the first token delta is emitted
        setTimeout(() => clientController.abort(), 10);
        return Promise.resolve(hangingBody('', init?.signal));
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    vi.stubGlobal('fetch', fetchSpy);
    const consoleLogSpy = vi.spyOn(console, 'log');

    const exp = Date.now() + 60_000;
    const sig = await hmac(chatTokenMessage(base.conversationId, base.userId, exp, base.models, await chatPayloadDigest(base)));

    const context = createContext({ ...base, exp, sig }, clientController.signal, waitUntilPromises);
    const res = await handleChatStream(context);
    expect(res.status).toBe(200);

    const sseOutput = await drainResponse(res);
    await Promise.all(waitUntilPromises);

    // Verify SSE frames: should NOT have persist saving/saved
    expect(sseOutput).not.toContain('"type":"persist"');
    expect(sseOutput).not.toContain('"type":"delta"');

    // Verify /api/chat/persist was NEVER called
    expect(persistFetchSpy).not.toHaveBeenCalled();

    // Verify summary log records outcome: 'client_abort'
    const summaryCall = consoleLogSpy.mock.calls.find((callArgs) => callArgs[0] === '[chat-cascade:summary]');
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[1]).toMatchObject({
      conversationId: base.conversationId,
      requestId: base.requestId,
      outcome: 'client_abort',
      partial: false,
    });
  });

  it('PARTIAL ABORT: request signal aborts after first delta -> /persist fetch called with partial text and outcome logged as client_abort', async () => {
    const clientController = new AbortController();
    const waitUntilPromises: Promise<unknown>[] = [];

    const persistFetchSpy = vi.fn();
    const fetchSpy = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
      if (urlStr.includes('/api/chat/persist')) {
        persistFetchSpy(urlStr, init);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (urlStr.includes('openrouter.ai')) {
        return Promise.resolve(hangingBody('This is partial generated text', init?.signal));
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${urlStr}`));
    });

    vi.stubGlobal('fetch', fetchSpy);
    const consoleLogSpy = vi.spyOn(console, 'log');

    const exp = Date.now() + 60_000;
    const sig = await hmac(chatTokenMessage(base.conversationId, base.userId, exp, base.models, await chatPayloadDigest(base)));

    const context = createContext({ ...base, exp, sig }, clientController.signal, waitUntilPromises);
    const res = await handleChatStream(context);
    expect(res.status).toBe(200);

    // Stream reader reads until the first delta, then aborts client
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      if (accumulated.includes('This is partial generated text') && !clientController.signal.aborted) {
        clientController.abort();
      }
    }

    await Promise.all(waitUntilPromises);

    // Verify /api/chat/persist was invoked
    expect(persistFetchSpy).toHaveBeenCalledTimes(1);
    const [persistUrl, persistInit] = persistFetchSpy.mock.calls[0] as [string, RequestInit];
    expect(persistUrl).toBe('https://test.getvintel.com/api/chat/persist');

    const persistPayload = JSON.parse(persistInit.body as string);
    // Persisted content must equal the partial text (no cut-off notice appended for client_abort)
    expect(persistPayload.content).toBe('This is partial generated text');
    expect(persistPayload.conversationId).toBe(base.conversationId);
    expect(persistPayload.userId).toBe(base.userId);
    // Note: status sent to /persist by atomicPersist on aborted signal is 'interrupted' or 'completed'
    // but the DB schema for messages does not store outcome/status column; outcome is tracked in summary log
    expect(['interrupted', 'completed']).toContain(persistPayload.status);

    // Verify summary log records outcome: 'client_abort' and partial: true
    const summaryCall = consoleLogSpy.mock.calls.find((callArgs) => callArgs[0] === '[chat-cascade:summary]');
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[1]).toMatchObject({
      conversationId: base.conversationId,
      requestId: base.requestId,
      outcome: 'client_abort',
      partial: true,
    });
  });
});
