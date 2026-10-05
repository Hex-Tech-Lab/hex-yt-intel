/**
 * T3 (10X PR scan P2): slice-fallback full-transcript re-runs are gated by the
 * A6 per-video cost budget (`analysis.jev.maxCostUsdCentsPerVideo`, carried on
 * the plan as costCapCents/fullTranscriptCallCents).
 *
 * Layers under test:
 *   1. Pure decision (evaluateFallbackBudget): near-cap refused / under-cap
 *      allowed / cumulative fallbacks crossing the cap mid-run refuse only the
 *      later fallbacks / unenforceable (legacy) plans allow / negative-input
 *      clamp.
 *   2. Ledger orchestration (checkAndRecordFallbackBudget): the Redis ledger
 *      holds ONLY cumulative fallback spend (the planned estimate must never
 *      leak into it — it is added separately on every evaluation); refusals
 *      and unenforceable plans write nothing; a missing cache adapter
 *      degrades to the per-request check.
 *   3. Route wiring (analyze-llm-stream): a budget-exhausted fallback fails
 *      the CELL via the existing error-frame semantics (no jev-fallback frame,
 *      NO OpenRouter call — the refusal fires before any LLM spend), while an
 *      in-budget fallback keeps today's exact behavior (jev-fallback frame +
 *      full transcript to OpenRouter) and records its cost; the SSE plan event
 *      strips the budget fields (JevPlanEventSchema is .strict()).
 */
import * as Sentry from '@sentry/cloudflare';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sliceDigest } from '../services/TranscriptSlice';
import { UpstashCacheAdapter } from '../services/UpstashCacheAdapter';
import {
  evaluateFallbackBudget,
  checkAndRecordFallbackBudget,
  ATOMIC_FALLBACK_BUDGET_LUA,
  fallbackSpendKey,
  parseCumulativeFallbackCents,
  type FallbackBudgetPlan,
} from '../services/JevFallbackBudget';

vi.mock('@sentry/cloudflare', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-000000000003';
const VIDEO_ID = 'vid123';
const TRANSCRIPT = 'zero one two three four five six seven eight nine ten';
const APP_URL = 'https://app.example.test';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PLAN_URL = `${APP_URL}/api/analyses/${ANALYSIS_ID}/plan`;
const UPSTASH_URL = 'https://upstash.example.test';
const FALLBACK_KEY = fallbackSpendKey(ANALYSIS_ID);
const BOGUS_HASH = 'ee'.repeat(32);

const BUNDLE_LIST: number[][] = [
  [1, 2, 3],
  [4, 5],
  [6, 7],
  [8, 10],
  [9, 11],
];
const GROUNDED_BUNDLES = 4;
const PROJECTIVE_BUNDLES = 1;
const JEV_CHUNK_COUNT = 2;
const STREAM_COUNT = JEV_CHUNK_COUNT * GROUNDED_BUNDLES + PROJECTIVE_BUNDLES; // 2*4 + 1 = 9

/** Plan carrying A6 budget context: planned 42¢, one full-transcript re-run 20¢. */
function makePlanWithBudget(overrides: Partial<FallbackBudgetPlan> = {}) {
  return {
    K: 2,
    streamCount: STREAM_COUNT,
    cells: [{ jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 3, sha256: 'aa'.repeat(32) }],
    estimateCents: 42,
    truncatedFallback: false,
    costCapCents: 100,
    fullTranscriptCallCents: 20,
    ...overrides,
  };
}

// ─── 1. Pure decision ────────────────────────────────────────────────────────

describe('evaluateFallbackBudget (T3 pure decision)', () => {
  it('refuses when the plan is already near the cap (planned + full-transcript re-run > cap)', () => {
    const decision = evaluateFallbackBudget({
      plan: { costCapCents: 50, fullTranscriptCallCents: 20 },
      plannedCents: 42,
      cumulativeFallbackCents: 0,
    });
    expect(decision.enforceable).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.projectedCents).toBe(62);
    expect(decision.capCents).toBe(50);
  });

  it('allows when the plan sits under the cap', () => {
    const decision = evaluateFallbackBudget({
      plan: { costCapCents: 100, fullTranscriptCallCents: 20 },
      plannedCents: 42,
      cumulativeFallbackCents: 0,
    });
    expect(decision.enforceable).toBe(true);
    expect(decision.allowed).toBe(true);
    expect(decision.projectedCents).toBe(62);
  });

  it('cumulative fallbacks crossing the cap mid-run refuse only the later fallbacks (exactly-at-cap stays allowed)', () => {
    const plan = { costCapCents: 100, fullTranscriptCallCents: 9 };
    const first = evaluateFallbackBudget({ plan, plannedCents: 80, cumulativeFallbackCents: 0 });
    expect(first.allowed).toBe(true); // 89 <= 100 — earlier fallback unaffected
    const second = evaluateFallbackBudget({ plan, plannedCents: 80, cumulativeFallbackCents: 11 });
    expect(second.allowed).toBe(true); // exactly at cap (100 <= 100)
    const third = evaluateFallbackBudget({ plan, plannedCents: 80, cumulativeFallbackCents: 20 });
    expect(third.allowed).toBe(false); // 109 > 100 — later fallback refused
  });

  it('unenforceable plans (legacy/degenerate: no budget fields) allow the fallback by contract', () => {
    for (const plan of [undefined, {}, { costCapCents: 100 }, { fullTranscriptCallCents: 9 }, { costCapCents: Number.NaN, fullTranscriptCallCents: 9 }]) {
      const decision = evaluateFallbackBudget({ plan, plannedCents: 42, cumulativeFallbackCents: 0 });
      expect(decision.enforceable).toBe(false);
      expect(decision.allowed).toBe(true);
    }
  });

  it('clamps negative planned/cumulative inputs (a forged inline plan must not loosen the guard)', () => {
    const decision = evaluateFallbackBudget({
      plan: { costCapCents: 8, fullTranscriptCallCents: 9 },
      plannedCents: -50,
      cumulativeFallbackCents: 0,
    });
    expect(decision.allowed).toBe(false); // clamped: 0 + 0 + 9 = 9 > 8
  });
});

// ─── 2. Ledger orchestration ─────────────────────────────────────────────────

function makeStubCache(): { store: Map<string, string>; adapter: UpstashCacheAdapter } {
  const store = new Map<string, string>();
  const adapter = {
    get: (key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
  return { store, adapter: adapter as unknown as UpstashCacheAdapter };
}

describe('checkAndRecordFallbackBudget (T3 ledger orchestration)', () => {
  it('records ONLY cumulative fallback spend (never the planned estimate) and trips when the cap is crossed', async () => {
    const { store, adapter } = makeStubCache();
    const plan = { costCapCents: 90, fullTranscriptCallCents: 20 };
    const plannedCents = 42;

    const first = await checkAndRecordFallbackBudget({ plan, plannedCents, analysisId: ANALYSIS_ID, cache: adapter });
    expect(first.decision.allowed).toBe(true); // 42 + 0 + 20 = 62 <= 90
    expect(store.get(FALLBACK_KEY)).toBe('20');

    const second = await checkAndRecordFallbackBudget({ plan, plannedCents, analysisId: ANALYSIS_ID, cache: adapter });
    expect(second.decision.allowed).toBe(true); // 42 + 20 + 20 = 82 <= 90
    expect(store.get(FALLBACK_KEY)).toBe('40');

    const third = await checkAndRecordFallbackBudget({ plan, plannedCents, analysisId: ANALYSIS_ID, cache: adapter });
    expect(third.decision.allowed).toBe(false); // 42 + 40 + 20 = 102 > 90
    expect(third.decision.projectedCents).toBe(102);
    expect(store.get(FALLBACK_KEY)).toBe('40'); // refusal writes nothing
  });

  it('unenforceable plans allow without writing the ledger', async () => {
    const { store, adapter } = makeStubCache();
    const outcome = await checkAndRecordFallbackBudget({
      plan: {},
      plannedCents: 42,
      analysisId: ANALYSIS_ID,
      cache: adapter,
    });
    expect(outcome.decision.enforceable).toBe(false);
    expect(outcome.decision.allowed).toBe(true);
    expect(store.size).toBe(0);
  });

  it('a missing cache adapter degrades to the per-request check (allowed here) without throwing', async () => {
    const outcome = await checkAndRecordFallbackBudget({
      plan: { costCapCents: 100, fullTranscriptCallCents: 20 },
      plannedCents: 42,
      analysisId: ANALYSIS_ID,
      cache: undefined,
    });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.recordedCents).toBe(20);
  });

  it('parseCumulativeFallbackCents treats absent/corrupt ledger values as 0', () => {
    expect(parseCumulativeFallbackCents(null)).toBe(0);
    expect(parseCumulativeFallbackCents('18')).toBe(18);
    expect(parseCumulativeFallbackCents('garbage')).toBe(0);
    expect(parseCumulativeFallbackCents('-5')).toBe(0);
  });

  it('C5: the atomic Lua script reads the ledger and records within ONE script (no app-level gap)', () => {
    expect(ATOMIC_FALLBACK_BUDGET_LUA).toContain("redis.call('GET'");
    expect(ATOMIC_FALLBACK_BUDGET_LUA).toContain("redis.call('SET'");
    // Records only when within budget (SET is inside the allow branch, before
    // the refusal return {0,...}):
    const refusalIdx = ATOMIC_FALLBACK_BUDGET_LUA.indexOf("return {0");
    expect(ATOMIC_FALLBACK_BUDGET_LUA.indexOf("redis.call('SET'")).toBeGreaterThanOrEqual(0);
    expect(ATOMIC_FALLBACK_BUDGET_LUA.indexOf("redis.call('SET'")).toBeLessThan(refusalIdx);  });

  it('C5: two parallel fallback cells race the ledger — exactly ONE is granted, the loser records nothing', async () => {
    const store = new Map<string, string>();
    // Eval stub applying ATOMIC_FALLBACK_BUDGET_LUA's decision atomically:
    // single-threaded JS with no await between GET and SET gives the same
    // indivisibility Redis gives the real script. LIMITATION (documented):
    // vitest has no real Redis, so the script text is not executed here — its
    // structure is asserted above and the decision semantics are mirrored
    // 1:1 from ATOMIC_FALLBACK_BUDGET_LUA (same inputs/outputs).
    const adapter = {
      eval: (script: string, key: string, args: string[]) => {
        if (script !== ATOMIC_FALLBACK_BUDGET_LUA) return Promise.resolve(null);
        const cur = Math.max(0, Number(store.get(key) ?? '0') || 0);
        const projected = Number(args[0]) + cur + Number(args[1]);
        if (projected <= Number(args[2])) {
          const newCum = Math.floor((cur + Number(args[1])) * 1e6 + 0.5) / 1e6;
          store.set(key, String(newCum));
          return Promise.resolve(['1', String(projected), String(newCum)]);
        }
        return Promise.resolve(['0', String(projected), String(cur)]);
      },
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      },
    };
    const plan = { costCapCents: 81, fullTranscriptCallCents: 20 };
    // cap 81: 42 + 0 + 20 = 62 allowed for the winner; the loser reads the
    // winner's ledger value 20 → 42 + 20 + 20 = 82 > 81 → refused.
    const [first, second] = await Promise.all([
      checkAndRecordFallbackBudget({ plan, plannedCents: 42, analysisId: ANALYSIS_ID, cache: adapter as unknown as UpstashCacheAdapter }),
      checkAndRecordFallbackBudget({ plan, plannedCents: 42, analysisId: ANALYSIS_ID, cache: adapter as unknown as UpstashCacheAdapter }),
    ]);
    expect([first.decision.allowed, second.decision.allowed].filter(Boolean)).toHaveLength(1);
    expect(store.get(FALLBACK_KEY)).toBe('20');
    const loser = first.decision.allowed ? second : first;
    expect(loser.recordedCents).toBe(0);
  });
});

// ─── 3. Route wiring ─────────────────────────────────────────────────────────

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
    'data: {"choices":[{"delta":{"content":"HELLO_GROUNDED_TOKEN"}}]}',
    'data: {"choices":[{}],"usage":{"total_tokens":100}}',
    'data: [DONE]',
  ]);
}

interface FetchLog {
  url: string;
  init?: RequestInit;
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
      return {
        event: eventLine ? stripSsePrefix(eventLine, 'event: ') : undefined,
        data: dataLine ? stripSsePrefix(dataLine, 'data: ') : '',
      };
    });
}

function extractFrames(frames: Array<{ event?: string; data: string }>, predicate: (parsed: Record<string, unknown>) => boolean) {
  return frames.filter((f) => {
    if (f.event) return false;
    try {
      return predicate(JSON.parse(f.data) as Record<string, unknown>);
    } catch (error) {
      console.error('[jev-fallback-budget-test]', error instanceof Error ? error.message : String(error));
      return false;
    }
  });
}

async function signV2Token(params: { chunkIndex: number }): Promise<{ sig: string; exp: number }> {
  const { signStreamTokenV2 } = await import('../../../web/lib/stream-token');
  const prevSecret = process.env.STREAM_HMAC_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.STREAM_HMAC_SECRET = SECRET;
  process.env.NODE_ENV = 'development';
  try {
    return await signStreamTokenV2({
      videoId: VIDEO_ID,
      analysisId: ANALYSIS_ID,
      models: [],
      streamCount: STREAM_COUNT,
      jevChunkIndex: 0,
      jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: params.chunkIndex,
      bundleList: BUNDLE_LIST,
      slice: { sha256: BOGUS_HASH, startWord: 0, endWord: 3 },
    });
  } finally {
    if (prevSecret === undefined) delete process.env.STREAM_HMAC_SECRET;
    else process.env.STREAM_HMAC_SECRET = prevSecret;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
}

describe('analyze-llm-stream fallback budget gating (T3 route-level)', () => {
  const originalFetch = globalThis.fetch;
  let analysisRoute: typeof import('../routes/analysis')['default'];
  let fetchLog: FetchLog[];
  let waitUntilPromises: Promise<unknown>[] = [];
  let upstashStore: Map<string, string>;
  /** Per-test override for the S2S /plan response body (default: makePlanWithBudget()). */
  let planResponseOverride: Record<string, unknown> | null = null;

  function makeEnv(withUpstash: boolean) {
    return {
      ENVIRONMENT: 'test',
      STREAM_HMAC_SECRET: SECRET,
      OPENROUTER_API_KEY: 'test-openrouter-key',
      APP_URL: APP_URL,
      ...(withUpstash ? { UPSTASH_REDIS_REST_URL: UPSTASH_URL, UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token' } : {}),
    };
  }

  beforeEach(async () => {
    fetchLog = [];
    waitUntilPromises = [];
    upstashStore = new Map();
    planResponseOverride = null;
    vi.clearAllMocks();

    // The UpstashCacheAdapter binds `fetch` at module-import time, so a
    // per-test global fetch mock cannot intercept it. Spy on the prototype
    // instead — the route constructs its own adapter instance from env vars.
    vi.spyOn(UpstashCacheAdapter.prototype, 'get').mockImplementation((key: string) => Promise.resolve(upstashStore.get(key) ?? null));
    vi.spyOn(UpstashCacheAdapter.prototype, 'set').mockImplementation((key: string, value: string) => {
      upstashStore.set(key, value);
      return Promise.resolve();
    });

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchLog.push({ url, init });
      if (url === PLAN_URL) {
        return Promise.resolve(new Response(JSON.stringify({ cached: false, plan: planResponseOverride ?? makePlanWithBudget() }), { status: 200 }));
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

  /** v2 grounded cell with a WRONG slice hash (mismatch path) and an optional inline plan. */
  async function runMismatchCell(chunkIndex: number, plan: Record<string, unknown> | undefined, withUpstash = false) {
    const { sig, exp } = await signV2Token({ chunkIndex });
    const logStart = fetchLog.length;
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        ...(plan !== undefined ? { jevPlan: plan } : {}),
        sig,
        exp,
        models: [],
        cascade: [{ model: 'anthropic/claude-haiku-4.5', name: 'Haiku 4.5', providerOrder: ['anthropic'] }],
        tokenVersion: 2,
        streamCount: STREAM_COUNT,
        jevChunkIndex: 0,
        jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex,
        bundleList: BUNDLE_LIST,
        dimensions: BUNDLE_LIST[chunkIndex - 1],
        sliceSha256: BOGUS_HASH,
        startWord: 0,
        endWord: 3,
      }),
    });
    const waitUntil = (promiseTask: Promise<unknown>) => {
      waitUntilPromises.push(promiseTask);
    };
    const res = await analysisRoute.request(req, undefined, makeEnv(withUpstash), { waitUntil } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const frames = parseSseFrames(await res.text());
    return {
      frames,
      openRouterCalled: fetchLog.slice(logStart).some((c) => c.url === OPENROUTER_URL),
    };
  }

  const errorFrames = (frames: Array<{ event?: string; data: string }>) =>
    extractFrames(frames, (p) => p.type === 'error');
  const fallbackFrames = (frames: Array<{ event?: string; data: string }>) =>
    extractFrames(frames, (p) => p.type === 'status' && p.stage === 'jev-fallback');
  const planFrames = (frames: Array<{ event?: string; data: string }>) =>
    frames.filter((f) => f.event === 'plan');

  it('budget exhausted -> cell fails via the existing error-frame semantics, NO LLM call, NO jev-fallback frame', async () => {
    // planned 42 + full-transcript re-run 20 = 62 > cap 50
    const { frames, openRouterCalled } = await runMismatchCell(1, makePlanWithBudget({ costCapCents: 50 }));

    expect(openRouterCalled).toBe(false);
    const errors = errorFrames(frames);
    expect(errors).toHaveLength(1);
    const errorPayload = JSON.parse(errors[0]!.data) as Record<string, unknown>;
    expect(errorPayload.code).toBe('ERR_JEV_FALLBACK_BUDGET_EXCEEDED');
    expect(String(errorPayload.error)).toContain('cost cap');
    expect(fallbackFrames(frames)).toHaveLength(0);
    // Both captures fire: the mismatch itself + the budget refusal.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'jev slice fallback refused: per-video cost budget exhausted',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({ plannedCents: 42, fullTranscriptCallCents: 20, capCents: 50, projectedCents: 62 }),
      }),
    );
  });

  it("budget remaining -> today's exact fallback behavior (jev-fallback frame + full transcript to OpenRouter); plan event strips budget fields", async () => {
    // planned 42 + 20 = 62 <= cap 100
    const { frames, openRouterCalled } = await runMismatchCell(1, makePlanWithBudget({ costCapCents: 100 }));

    expect(openRouterCalled).toBe(true);
    expect(fallbackFrames(frames)).toHaveLength(1);
    expect(JSON.parse(fallbackFrames(frames)[0]!.data)).toEqual({
      type: 'status',
      stage: 'jev-fallback',
      reason: 'slice_hash_mismatch',
    });
    expect(errorFrames(frames)).toHaveLength(0);
    // The named plan event must NOT leak the budget fields (.strict() client schema).
    expect(planFrames(frames)).toHaveLength(1);
    const planPayload = JSON.parse(planFrames(frames)[0]!.data) as Record<string, unknown>;
    expect(planPayload).not.toHaveProperty('costCapCents');
    expect(planPayload).not.toHaveProperty('fullTranscriptCallCents');
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      'jev slice fallback refused: per-video cost budget exhausted',
      expect.anything(),
    );
  });

  it('cumulative fallback spend crosses the cap mid-run via the Redis ledger: first cell falls back, second is refused', async () => {
    // cap 81: cell 1 -> 42+0+20=62 allowed (ledger 20); cell 2 -> 42+20+20=82 refused.
    const first = await runMismatchCell(1, makePlanWithBudget({ costCapCents: 81 }), true);
    expect(fallbackFrames(first.frames)).toHaveLength(1);
    expect(first.openRouterCalled).toBe(true);
    expect(upstashStore.get(FALLBACK_KEY)).toBe('20');

    const second = await runMismatchCell(2, makePlanWithBudget({ costCapCents: 81 }), true);
    expect(fallbackFrames(second.frames)).toHaveLength(0);
    expect(second.openRouterCalled).toBe(false);
    const errors = errorFrames(second.frames);
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0]!.data).code).toBe('ERR_JEV_FALLBACK_BUDGET_EXCEEDED');
    expect(upstashStore.get(FALLBACK_KEY)).toBe('20'); // refusal writes nothing
  });

  it('an S2S-fetched plan (no inline jevPlan) carries the budget fields through /plan and gates the fallback', async () => {
    // The fetched plan must pass isValidJevPlan WITH its budget fields and be
    // ENFORCED: cap 50 => planned 42 + 20 = 62 > 50 -> refused. If the shape
    // check dropped the fields, the plan would degrade to unenforceable and
    // the fallback would proceed — this test fails in that case.
    planResponseOverride = makePlanWithBudget({ costCapCents: 50 });
    const { frames, openRouterCalled } = await runMismatchCell(1, undefined);
    expect(openRouterCalled).toBe(false);
    expect(errorFrames(frames)).toHaveLength(1);
    expect(JSON.parse(errorFrames(frames)[0]!.data).code).toBe('ERR_JEV_FALLBACK_BUDGET_EXCEEDED');
    expect(fallbackFrames(frames)).toHaveLength(0);
  });
});
