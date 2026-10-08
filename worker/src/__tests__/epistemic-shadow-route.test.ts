/**
 * Phase C shadow mode (2026-10-08), route level: the live /analyze-llm-stream
 * endpoint starts the Epistemic pipeline (runEpistemicShadow -> dispatcher)
 * in the background ONLY for a valid Vercel-signed grant, and always still
 * serves the legacy stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signEpistemicShadow } from '../../../web/lib/config/epistemic-shadow';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../services/EpistemicShadowRunner', () => ({ runEpistemicShadow: vi.fn(() => Promise.resolve()) }));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-0000000000e5';
const VIDEO_ID = 'vidShadow';
const TRANSCRIPT = 'speaker one says a thing and speaker two answers it';
const APP_URL = 'https://app.example.test';

function sse(lines: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  }), { status: 200 });
}

async function signV1(): Promise<{ sig: string; exp: number }> {
  const { signStreamToken } = await import('../../../web/lib/stream-token');
  const prev = { secret: process.env.STREAM_HMAC_SECRET, nodeEnv: process.env.NODE_ENV };
  process.env.STREAM_HMAC_SECRET = SECRET;
  process.env.NODE_ENV = 'development';
  try {
    return await signStreamToken(VIDEO_ID, ANALYSIS_ID, []);
  } finally {
    if (prev.secret === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev.secret;
    if (prev.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.nodeEnv;
  }
}

describe('analyze-llm-stream epistemic shadow wiring', () => {
  const originalFetch = globalThis.fetch;
  let pending: Promise<unknown>[];

  beforeEach(async () => {
    pending = [];
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    vi.mocked(runEpistemicShadow).mockClear();
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('https://openrouter.ai/')) {
        return Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(pending);
  });

  async function run(extra: Record<string, unknown>): Promise<number> {
    const route = (await import('../routes/analysis')).default;
    const { sig, exp } = await signV1();
    const body = {
      videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'Shadow test', duration: 120 },
      transcript: TRANSCRIPT, sig, exp, models: [],
      cascade: [{ model: 'test/model-a', name: 'Model A' }], dimensions: [1, 2, 3], chunkIndex: 1, totalChunks: 5,
      appUrl: APP_URL, ...extra,
    };
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const env = { ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    await res.text();
    await Promise.allSettled(pending);
    return res.status;
  }

  it('starts the Epistemic pipeline with the resolved transcript for a valid grant', async () => {
    const grant = await signEpistemicShadow(SECRET, ANALYSIS_ID);
    const status = await run({ epistemicShadowSig: grant.sig, epistemicShadowExp: grant.exp });
    expect(status).toBe(200);
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    expect(runEpistemicShadow).toHaveBeenCalledTimes(1);
    const params = vi.mocked(runEpistemicShadow).mock.calls[0]![0];
    expect(params.analysisId).toBe(ANALYSIS_ID);
    expect(params.transcript).toBe(TRANSCRIPT);
    expect(params.durationSeconds).toBe(120);
    expect(params.appUrl).toBe(APP_URL);
  });

  it('does not start it without a grant (legacy stream only)', async () => {
    expect(await run({})).toBe(200);
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    expect(runEpistemicShadow).not.toHaveBeenCalled();
  });

  it('does not start it for a forged or cross-analysis grant', async () => {
    const other = await signEpistemicShadow(SECRET, 'a-different-analysis');
    expect(await run({ epistemicShadowSig: other.sig, epistemicShadowExp: other.exp })).toBe(200);
    const forged = await signEpistemicShadow('wrong-secret', ANALYSIS_ID);
    expect(await run({ epistemicShadowSig: forged.sig, epistemicShadowExp: forged.exp })).toBe(200);
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    expect(runEpistemicShadow).not.toHaveBeenCalled();
  });

  it('does not start it for an expired grant', async () => {
    const expired = await signEpistemicShadow(SECRET, ANALYSIS_ID, Date.now() - 60 * 60 * 1000);
    expect(await run({ epistemicShadowSig: expired.sig, epistemicShadowExp: expired.exp })).toBe(200);
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    expect(runEpistemicShadow).not.toHaveBeenCalled();
  });
});
