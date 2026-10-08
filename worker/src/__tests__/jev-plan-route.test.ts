/**
 * R3b 2.3W route-level tests: the `event: plan` SSE frame behavior of
 * POST /analyze-llm-stream (buildStreamResponse's plan resolution block).
 *
 * Contract under test (ADR 037 Addendum A):
 *   - Grounded bundles with no inline jevPlan: exactly one named
 *     `event: plan` frame is emitted BEFORE the first grounded delta token,
 *     sourced from the S2S POST to {appUrl}/api/analyses/{id}/plan.
 *   - Any /plan failure (500, reject, bad JSON/malformed plan) degrades to a
 *     K=1 fallback plan frame and the stream proceeds unchanged (OpenRouter
 *     is still called, tokens still stream).
 *   - A valid inline req.jevPlan is emitted directly with source 'inline'
 *     and /plan is never fetched.
 *   - Projective bundles ([9,11]) never call /plan and never get a plan frame.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hmacHex } from '../crypto';
import { isProjectiveBundle } from '../../../web/lib/config/synthesis';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const VIDEO_ID = 'vid123';
const TRANSCRIPT = 'alpha beta gamma delta epsilon';
const APP_URL = 'https://app.example.test';
const PLAN_URL = `${APP_URL}/api/analyses/${ANALYSIS_ID}/plan`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DELTA_TOKEN = 'HELLO_GROUNDED_TOKEN';

const CASCADE = [{ model: 'test/model-a', name: 'Model A', providerOrder: ['anthropic'] }];

function makePlan() {
  return {
    K: 2,
    streamCount: 11,
    cells: [
      { jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 3, sha256: 'aa'.repeat(32) },
      { jevChunkIndex: 1, chunkIndex: 2, startWord: 3, endWord: 5, sha256: 'bb'.repeat(32) },
    ],
    estimateCents: 42,
    truncatedFallback: false,
  };
}

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

function openRouterResponse(): Response {
  return sseResponse([
    `data: {"choices":[{"delta":{"content":"${DELTA_TOKEN}"}}]}`,
    'data: {"choices":[{}],"usage":{"total_tokens":100}}',
    'data: [DONE]',
  ]);
}

interface FetchLog {
  url: string;
  init?: RequestInit;
}

interface ScenarioOptions {
  planStatus?: number;
  planBody?: string;
  planReject?: boolean;
  inlinePlan?: unknown;
  dimensions?: number[];
}

function makeEnv() {
  return {
    ENVIRONMENT: 'test',
    STREAM_HMAC_SECRET: SECRET,
    OPENROUTER_API_KEY: 'test-openrouter-key',
    APP_URL: APP_URL,
  };
}

async function buildRequest(opts: ScenarioOptions): Promise<Request> {
  const exp = Date.now() + 60_000;
  const models: string[] = [];
  const sig = await hmacHex(SECRET, `${VIDEO_ID}:${ANALYSIS_ID}:${exp}:${models.sort().join(',')}`);
  const body: Record<string, unknown> = {
    videoId: VIDEO_ID,
    analysisId: ANALYSIS_ID,
    metadata: { title: 'Test Video', duration: 60 },
    transcript: TRANSCRIPT,
    sig,
    exp,
    models,
    cascade: CASCADE,
    dimensions: opts.dimensions ?? [1, 2, 3],
  };
  if (opts.inlinePlan !== undefined) body.jevPlan = opts.inlinePlan;
  return new Request(`${APP_URL}/analyze-llm-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stripSsePrefix(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.replace(prefix, '') : line;
}

function parseSseFrames(raw: string): Array<{ event?: string; data: string }> {
  return raw
    .split(/\r?\n\r?\n/)
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      return { event: eventLine ? stripSsePrefix(eventLine, 'event: ') : undefined, data: dataLine ? stripSsePrefix(dataLine, 'data: ') : '' };
    });
}

describe('analyze-llm-stream plan event (R3b 2.3W route-level)', () => {
  const originalFetch = globalThis.fetch;
  let analysisRoute: typeof import('../routes/analysis')['default'];
  let fetchLog: FetchLog[];
  let waitUntilPromises: Promise<unknown>[] = [];

  beforeEach(async () => {
    fetchLog = [];
    waitUntilPromises = [];
    // PersistService binds `const rawFetch = fetch` at module-load; the stub
    // must exist BEFORE the route module is imported or persist retries hit
    // real DNS and hang afterEach past the hook timeout.
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchLog.push({ url, init });
      if (url === PLAN_URL) {
        return Promise.resolve(new Response(JSON.stringify({ cached: false, plan: makePlan() }), { status: 200 }));
      }
      if (url === OPENROUTER_URL) {
        return Promise.resolve(openRouterResponse());
      }
      if (url === `${APP_URL}/api/analyses/persist`) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response('unexpected fetch in test', { status: 404 }));
    }) as unknown as typeof fetch;
    analysisRoute = (await import('../routes/analysis')).default;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(waitUntilPromises);
  });

  async function runScenario(opts: ScenarioOptions): Promise<Array<{ event?: string; data: string }>> {
    // Apply per-scenario /plan behavior; scenarios without a /plan mutation
    // keep the default stub untouched.
    let inner = globalThis.fetch;
    if (opts.planStatus !== undefined || opts.planReject) {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === PLAN_URL) {
          if (opts.planReject) return Promise.reject(new Error('plan endpoint unreachable'));
          return Promise.resolve(new Response(opts.planBody ?? '', { status: opts.planStatus ?? 200 }));
        }
        return (inner as (i: RequestInfo | URL, requestInit?: RequestInit) => Promise<Response>)(input, init);
      }) as typeof fetch;
    }

    const req = await buildRequest(opts);
    const waitUntil = (waitUntilPromise: Promise<unknown>) => {
      waitUntilPromises.push(waitUntilPromise);
    };
    const res = await analysisRoute.request(req, undefined, makeEnv(), { waitUntil } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const raw = await res.text();
    return parseSseFrames(raw);
  }

  function planFrames(frames: Array<{ event?: string; data: string }>) {
    return frames.filter((f) => f.event === 'plan');
  }

  function firstPlanFrame(frames: Array<{ event?: string; data: string }>): { event?: string; data: string } {
    const first = planFrames(frames)[0];
    if (!first) throw new Error('expected at least one plan frame');
    return first;
  }

  function firstDeltaIndex(frames: Array<{ event?: string; data: string }>): number {
    return frames.findIndex((f) => {
      if (f.event) return false;
      try {
        return JSON.parse(f.data).type === 'delta';
      } catch (parseError) {
        console.error('[jev-plan-route-test] non-delta frame data was not valid JSON:', parseError instanceof Error ? parseError.message : String(parseError));
        return false;
      }
    });
  }

  it('(a) grounded bundle + no inline plan: exactly one plan frame from /plan, emitted before the first delta token', async () => {
    const frames = await runScenario({});

    const plans = planFrames(frames);
    expect(plans).toHaveLength(1);
    const payload = JSON.parse(firstPlanFrame(frames).data);
    expect(payload).toMatchObject({ v: 1, source: 'worker', K: 2, streamCount: 11, estimateCents: 42, truncatedFallback: false });
    expect(payload.cells).toEqual(makePlan().cells);

    const planIdx = frames.indexOf(firstPlanFrame(frames));
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(deltaIdx);

    const planCalls = fetchLog.filter((c) => c.url === PLAN_URL);
    expect(planCalls).toHaveLength(1);
    const firstPlanCall = planCalls[0];
    expect(firstPlanCall).toBeDefined();
    if (!firstPlanCall) throw new Error('unreachable: planCalls asserted non-empty above');
    expect(firstPlanCall.init?.method).toBe('POST');
    const reqBody = JSON.parse(firstPlanCall.init?.body as string);
    expect(reqBody.videoId).toBe(VIDEO_ID);
    expect(reqBody.transcript).toBe(TRANSCRIPT);
    expect(typeof reqBody.sig).toBe('string');
    expect(typeof reqBody.exp).toBe('number');
  });

  it('(b) /plan returns 500: K=1 fallback plan frame, OpenRouter still called, tokens still stream', async () => {
    const frames = await runScenario({ planStatus: 500, planBody: 'boom' });

    const plans = planFrames(frames);
    expect(plans).toHaveLength(1);
    const payload = JSON.parse(firstPlanFrame(frames).data);
    expect(payload).toMatchObject({ v: 1, source: 'worker', K: 1, truncatedFallback: false });
    expect(payload.cells).toEqual([]);

    const planIdx = frames.indexOf(firstPlanFrame(frames));
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(deltaIdx);

    expect(fetchLog.some((c) => c.url === OPENROUTER_URL)).toBe(true);
    const rawDeltas = frames.filter((f) => !f.event && f.data.includes(DELTA_TOKEN));
    expect(rawDeltas.length).toBeGreaterThan(0);
  });

  it('(c) /plan fetch rejects: same K=1 fallback degradation, stream continues', async () => {
    const frames = await runScenario({ planReject: true });

    const plans = planFrames(frames);
    expect(plans).toHaveLength(1);
    const payload = JSON.parse(firstPlanFrame(frames).data);
    expect(payload).toMatchObject({ v: 1, source: 'worker', K: 1, truncatedFallback: false });

    const planIdx = frames.indexOf(firstPlanFrame(frames));
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(deltaIdx);

    expect(fetchLog.some((c) => c.url === OPENROUTER_URL)).toBe(true);
  });

  it('(d) /plan 200 with malformed body: K=1 fallback degradation, stream continues', async () => {
    const frames = await runScenario({ planStatus: 200, planBody: '{"not":"a plan"{{' });

    const plans = planFrames(frames);
    expect(plans).toHaveLength(1);
    const payload = JSON.parse(firstPlanFrame(frames).data);
    expect(payload).toMatchObject({ v: 1, source: 'worker', K: 1, truncatedFallback: false });

    const planIdx = frames.indexOf(firstPlanFrame(frames));
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(deltaIdx);

    expect(fetchLog.some((c) => c.url === OPENROUTER_URL)).toBe(true);
  });

  it('(e) valid inline jevPlan: emitted with source inline, /plan never fetched', async () => {
    const inlinePlan = makePlan();
    const frames = await runScenario({ inlinePlan });

    const plans = planFrames(frames);
    expect(plans).toHaveLength(1);
    const payload = JSON.parse(firstPlanFrame(frames).data);
    expect(payload).toMatchObject({ v: 1, source: 'inline', K: inlinePlan.K, streamCount: inlinePlan.streamCount });
    expect(payload.cells).toEqual(inlinePlan.cells);

    const planIdx = frames.indexOf(firstPlanFrame(frames));
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(deltaIdx);

    expect(fetchLog.some((c) => c.url === PLAN_URL)).toBe(false);
  });

  it('(f) projective bundle [9,11]: no /plan fetch and no plan frame at all', async () => {
    expect(isProjectiveBundle([9, 11])).toBe(true);
    const frames = await runScenario({ dimensions: [9, 11] });

    expect(planFrames(frames)).toHaveLength(0);
    expect(fetchLog.some((c) => c.url === PLAN_URL)).toBe(false);

    // The stream itself still runs to completion for projective bundles.
    const deltaIdx = firstDeltaIndex(frames);
    expect(deltaIdx).toBeGreaterThan(-1);
    const complete = frames.find((f) => !f.event && f.data.includes('"type":"complete"'));
    expect(complete).toBeDefined();
  });
});
