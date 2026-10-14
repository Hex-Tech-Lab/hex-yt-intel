// ADR-043 Part A: the SSE `meta` frame carries the per-turn intent contract, the
// router settings are bound into the stream signature, and a router failure never
// fails the turn. Network is stubbed by URL: Jev decisions vs the OpenRouter stream.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleChatStream } from '../chat-stream';
import { chatPayloadDigest, chatTokenMessage } from '../../../web/lib/utils/chat-payload-digest';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const SECRET = 'test-secret';
const enc = new TextEncoder();
async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const INTENT_CONFIG = {
  enabled: true,
  overrideConfidence: 0.75,
  timeoutMs: 15000,
  modelByIntent: {
    writing: 'primary',
    comments_lookup: 'cheap',
    citation_lookup: 'cheap',
    metadata: 'cheap',
    general_grounded_qa: 'primary',
  },
};

const base = {
  conversationId: 'conv-1',
  userId: 'user-1',
  requestId: 'req-1',
  tier: 'pro',
  grounding: 'Only talk about this video.',
  history: [{ role: 'user', content: 'Write a LinkedIn post about this talk' }],
  models: ['openai/gpt-oss-120b'],
  cascade: [{ model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', providerOrder: ['cerebras'] }],
};

function ctx(body: Record<string, unknown>) {
  return {
    req: { json: () => Promise.resolve(body), raw: new Request('https://w.test/chat-stream', { method: 'POST' }) },
    env: { STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', ENVIRONMENT: 'production' },
    json: (responseBody: unknown, status: number) => new Response(JSON.stringify(responseBody), { status }),
    executionCtx: { waitUntil: () => {} },
  } as unknown as Parameters<typeof handleChatStream>[0];
}

type Call = { url: string; body: Record<string, unknown> | undefined };

/** Routes Jev decisions to `jevReply` and the OpenRouter chat stream to a one-token reply. */
function stubNetwork(jevReply: { label: string } | 'error'): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const u = String(url);
    calls.push({ url: u, body });
    if (u.includes('/api/alpha/decisions')) {
      if (jevReply === 'error') return Promise.resolve(new Response('upstream down', { status: 500 }));
      return Promise.resolve(new Response(
        JSON.stringify({ model: 'typesafe/jev-1.13-20260917', answers: { intent: { type: 'choice', choice: jevReply.label, confidence: 0.9 } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    if (u.includes('/api/v1/chat/completions')) {
      return Promise.resolve(new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
  return calls;
}

/** Signs the body the way ProcessChatMessageUseCase does: the digest binds intentConfig too. */
async function signedBody(overrides: Record<string, unknown> = {}) {
  const payload = { ...base, ...overrides };
  const exp = Date.now() + 60_000;
  const digest = await chatPayloadDigest(payload as Parameters<typeof chatPayloadDigest>[0]);
  const sig = await hmac(chatTokenMessage(base.conversationId, base.userId, exp, base.models, digest));
  return { ...payload, exp, sig };
}

/** Reads the whole SSE body and returns the raw text plus the parsed `meta` frame. */
async function readStream(res: Response): Promise<{ text: string; meta: Record<string, unknown> }> {
  const text = await res.text();
  const block = text.split('\n\n').find((f) => f.startsWith('event: meta'));
  if (!block) throw new Error(`no meta frame in stream: ${text.slice(0, 200)}`);
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) throw new Error('meta frame has no data line');
  return { text, meta: JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown> };
}

describe('chat stream intent metadata (ADR-043 Part A)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the meta frame unchanged when the router is disabled', async () => {
    const calls = stubNetwork({ label: 'writing' });
    const res = await handleChatStream(ctx(await signedBody()));
    expect(res.status).toBe(200);
    const { meta } = await readStream(res);
    expect(Object.keys(meta).sort()).toEqual(['cascade', 'models', 'requestId', 'tier']);
    expect(calls.some((c) => c.url.includes('/api/alpha/decisions'))).toBe(false);
  });

  it.each([
    ['writing', true, true, 'primary'],
    ['comments_lookup', false, false, 'cheap'],
    ['citation_lookup', false, false, 'cheap'],
    ['metadata', false, false, 'cheap'],
    ['general_grounded_qa', false, false, 'primary'],
  ])('carries the %s contract on the meta frame', async (intent, chip, timestamps, modelTier) => {
    stubNetwork({ label: intent });
    const res = await handleChatStream(ctx(await signedBody({ intentConfig: INTENT_CONFIG })));
    expect(res.status).toBe(200);
    const { meta } = await readStream(res);
    expect(meta).toMatchObject({
      intent,
      suppressCommentsChip: chip,
      suppressTimestamps: timestamps,
      modelTier,
      intentVersion: 1,
      requestId: 'req-1',
    });
  });

  it('adds the timestamp instruction only on writing turns', async () => {
    const SUPPRESS = 'Do not add timestamps';
    const writingCalls = stubNetwork({ label: 'writing' });
    await readStream(await handleChatStream(ctx(await signedBody({ intentConfig: INTENT_CONFIG }))));
    const writingMessages = writingCalls.find((c) => c.url.includes('/api/v1/chat/completions'))!.body!.messages as Array<{ content: string }>;
    expect(writingMessages.some((m) => m.content.includes(SUPPRESS))).toBe(true);

    vi.unstubAllGlobals();
    const qaCalls = stubNetwork({ label: 'general_grounded_qa' });
    await readStream(await handleChatStream(ctx(await signedBody({ intentConfig: INTENT_CONFIG }))));
    const qaMessages = qaCalls.find((c) => c.url.includes('/api/v1/chat/completions'))!.body!.messages as Array<{ content: string }>;
    expect(qaMessages.some((m) => m.content.includes(SUPPRESS))).toBe(false);
  });

  it('never fails the turn when Jev is down; falls back to general_grounded_qa', async () => {
    stubNetwork('error');
    const res = await handleChatStream(ctx(await signedBody({ intentConfig: INTENT_CONFIG })));
    expect(res.status).toBe(200);
    const { text, meta } = await readStream(res);
    expect(meta).toMatchObject({ intent: 'general_grounded_qa', suppressCommentsChip: false, suppressTimestamps: false });
    expect(text).toContain('"content":"ok"');
  });

  it('rejects a token when the router settings are edited in transit', async () => {
    stubNetwork({ label: 'writing' });
    const signed = await signedBody({ intentConfig: INTENT_CONFIG });
    const tampered = { ...signed, intentConfig: { ...INTENT_CONFIG, timeoutMs: 30000 } };
    const res = await handleChatStream(ctx(tampered));
    expect(res.status).toBe(401);
  });

  it('treats malformed router settings as disabled for the turn, not as a failed turn', async () => {
    stubNetwork({ label: 'writing' });
    const malformed = { ...INTENT_CONFIG, overrideConfidence: 9 };
    const res = await handleChatStream(ctx(await signedBody({ intentConfig: malformed })));
    expect(res.status).toBe(200);
    const { meta } = await readStream(res);
    expect(Object.keys(meta).sort()).toEqual(['cascade', 'models', 'requestId', 'tier']);
  });

  it('digest is unchanged when intentConfig is absent', async () => {
    expect(await chatPayloadDigest({ ...base, intentConfig: undefined } as Parameters<typeof chatPayloadDigest>[0]))
      .toBe(await chatPayloadDigest(base as Parameters<typeof chatPayloadDigest>[0]));
  });
});
