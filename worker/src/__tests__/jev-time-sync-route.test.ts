/**
 * R3b Phase 2.6 route-level tests (worker /analyze-llm-stream):
 *   (f) a v2 K>1 cell's prompt carries REAL absolute [HH:MM:SS] markers from
 *       the timed segments (never restarting at 00:00:00) plus a range header;
 *   (g) the "Transcript truncated" status measures the CELL's prompt text,
 *       not the whole video's transcript.
 * Harness mirrors jev-slice-route.test.ts (split for the 500-line rule).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sliceDigest } from '../services/TranscriptSlice';
import { hmacHex } from '../crypto';
import { isProjectiveBundle } from '../../../web/lib/config/synthesis';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const VIDEO_ID = 'vid123';
const TRANSCRIPT = 'zero one two three four five six seven eight nine ten';
const APP_URL = 'https://app.example.test';
const PLAN_URL = `${APP_URL}/api/analyses/${ANALYSIS_ID}/plan`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CASCADE = [{ model: 'anthropic/claude-haiku-4.5', name: 'Haiku 4.5', providerOrder: ['anthropic'] }];
const BUNDLE_LIST: number[][] = [[1, 2, 3], [4, 5], [6, 7], [8, 10], [9, 11]];
const JEV_CHUNK_COUNT = 2;
const STREAM_COUNT = JEV_CHUNK_COUNT * 4 + 1;
// One word per segment, 10 s apart: "zero"@0 ... "ten"@100.
const SEGMENTS = TRANSCRIPT.split(' ').map((text, index) => ({ start: index * 10, duration: 10, text }));

function sse(lines: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  }), { status: 200 });
}

// PersistService and UpstashCacheAdapter capture `fetch` into a module-level
// rawFetch at import time — the FIRST test's mock instance — so per-test mock
// replacement silently reroutes persist/cache traffic to a stale handler the
// current test cannot observe. One shared instance with a swappable handler
// keeps rawFetch === the live dispatch for the whole file.
type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let activeFetchHandler: FetchHandler = () => Promise.resolve(new Response('{}', { status: 200 }));
const sharedFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => activeFetchHandler(input, init)) as unknown as typeof fetch;
const sharedFetchMock = sharedFetch as unknown as ReturnType<typeof vi.fn>;

async function signV2(startWord: number, endWord: number, sha256: string) {
  const { signStreamTokenV2 } = await import('../../../web/lib/stream-token');
  const prev = { secret: process.env.STREAM_HMAC_SECRET, nodeEnv: process.env.NODE_ENV };
  process.env.STREAM_HMAC_SECRET = SECRET;
  process.env.NODE_ENV = 'development';
  try {
    return await signStreamTokenV2({
      videoId: VIDEO_ID, analysisId: ANALYSIS_ID, models: [], streamCount: STREAM_COUNT,
      jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT, chunkIndex: 1, bundleList: BUNDLE_LIST,
      slice: { sha256, startWord, endWord },
    });
  } finally {
    if (prev.secret === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev.secret;
    if (prev.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.nodeEnv;
  }
}

describe('analyze-llm-stream Phase 2.6 time-sync (route-level)', () => {
  const originalFetch = globalThis.fetch;
  let route: typeof import('../routes/analysis')['default'];
  let openRouterBodies: string[];
  let pending: Promise<unknown>[];

  beforeEach(async () => {
    openRouterBodies = [];
    pending = [];
    sharedFetchMock.mockClear();
    activeFetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === PLAN_URL) return Promise.resolve(new Response(JSON.stringify({ cached: true, plan: null }), { status: 200 }));
      if (url === OPENROUTER_URL) {
        openRouterBodies.push(String(init?.body ?? ''));
        return Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']));
      }
      if (url.startsWith('https://cache.example.test/get/transcript:')) {
        // #417 provenance guard: markers come ONLY from worker-fetched/cache
        // segments now, so the harness delivers them via the worker's own
        // transcript-cache HIT (written exclusively from fetch results ->
        // trusted). cacheSegments below is what the worker itself "fetched".
        return Promise.resolve(new Response(JSON.stringify({ result: JSON.stringify({ transcript: cacheTranscript, segments: cacheSegments }) }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    globalThis.fetch = sharedFetch;
    route = (await import('../routes/analysis')).default;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(pending);
  });

  let cacheSegments: unknown = SEGMENTS;
  let cacheTranscript: string = TRANSCRIPT;

  /**
   * #417 provenance: segments reach the worker's trusted path ONLY via its
   * own fetch/cache. Passing workerSegments (default SEGMENTS) runs the
   * trusted mode: the request carries NO transcript/segments and the mocked
   * Upstash transcript-cache HIT (a payload only the worker's fetch path
   * ever writes) supplies both. Passing workerSegments === null runs the
   * untrusted mode: the request carries its own transcript (+ extra.segments
   * if given) and NO cache env, so the fetch short-circuits and
   * req.segments survive untrusted.
   */
  async function run(extra: Record<string, unknown>, workerSegments: unknown = SEGMENTS, workerTranscript?: string): Promise<{ prompt: string; raw: string }> {
    const trusted = workerSegments !== null;
    cacheSegments = trusted ? workerSegments : undefined;
    cacheTranscript = workerTranscript ?? (extra.transcript as string) ?? TRANSCRIPT;
    const hash = await sliceDigest(TRANSCRIPT, 2, 6);
    const { sig, exp } = await signV2(2, 6, hash);
    const body: Record<string, unknown> = {
      videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'T', duration: 110 },
      sig, exp, models: [], cascade: CASCADE, dimensions: [1, 2, 3],
      tokenVersion: 2, streamCount: STREAM_COUNT, jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 1, bundleList: BUNDLE_LIST, sliceSha256: hash, startWord: 2, endWord: 6, ...extra,
    };
    if (trusted) {
      delete body.transcript;
      delete body.segments;
    }
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const env = {
      ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL,
      ...(trusted ? { UPSTASH_REDIS_REST_URL: 'https://cache.example.test', UPSTASH_REDIS_REST_TOKEN: 'tok' } : {}),
    };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const parsed = JSON.parse(openRouterBodies[0] ?? '{}') as { messages?: Array<{ content: unknown }> };
    const prompt = (parsed.messages ?? [])
      .map((message) => (typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map((block: { text?: string }) => block.text ?? '').join('\n') : ''))
      .join('\n');
    return { prompt, raw };
  }

  it('(f) a v2 cell reads REAL absolute times from the segments, never restarting at 00:00:00', async () => {
    const { prompt } = await run({}, SEGMENTS);
    expect(prompt).toContain('[TIMELINE] This transcript excerpt covers 00:00:20–00:01:00 of a 00:01:50 video.');
    expect(prompt).toContain('[00:00:20] two [00:00:30] three four five');
    expect(prompt).not.toContain('[00:00:00]');
  });

  it('(g) the truncation warning measures the CELL\'s plain words — not the whole video, not the markers', async () => {
    // Budget 40 chars: the full transcript (53) is over it; the 4-word slice
    // (19 chars) is not, even though its annotated text (header + markers) is.
    const { raw, prompt } = await run({ transcriptBudgetChars: 40 }, SEGMENTS);
    expect(raw).not.toContain('transcript-truncated');
    expect(prompt).toContain('[00:00:20] two [00:00:30] three four five');
    expect(prompt).not.toContain('excerpt truncated');
  });

  it('(h) a budget that cuts the cell: plain words decide the cut, the visible range is stated, no mid-marker cut', async () => {
    // "two three" = 9 chars fits a 12-char budget; "two three four" (14) does not.
    const { raw, prompt } = await run({ transcriptBudgetChars: 12 }, SEGMENTS);
    expect(raw).toContain('transcript-truncated');
    expect(prompt).toContain('covers 00:00:20–00:00:40'); // "three" segment 30 s + 10 s
    expect(prompt).toContain('[00:00:20] two [00:00:30] three');
    expect(prompt).not.toContain('three four'); // the cut word never reaches the model
    expect(prompt).toContain('excerpt truncated to fit the prompt budget');
  });

  it('(i) raw whitespace never fakes a truncation: the warning follows the annotator\'s word-joined cut', async () => {
    const spaced = TRANSCRIPT.split(' ').join('  '); // 63 raw chars, 53 single-space-joined
    // #417 provenance: deliver the spaced transcript through the worker's
    // trusted cache path (request must not carry it — that would skip the
    // fetch/cache path and leave segments untrusted).
    const { raw } = await run({ transcriptBudgetChars: 55 }, SEGMENTS, spaced);
    expect(raw).not.toContain('transcript-truncated');
  });

  it('(j) provider-estimated timing: plain text, and no misleading "do not align" Sentry warning', async () => {
    const Sentry = await import('@sentry/cloudflare');
    vi.mocked(Sentry.captureMessage).mockClear();
    const estimated = SEGMENTS.map((segment) => ({ ...segment, estimated: true }));
    const { prompt } = await run({}, estimated);
    expect(prompt).not.toContain('[TIMELINE]');
    expect(vi.mocked(Sentry.captureMessage).mock.calls.some(([message]) => String(message).includes('do not align'))).toBe(false);
  });

  it('(k) segments that genuinely do not align: plain text AND a Sentry warning', async () => {
    const Sentry = await import('@sentry/cloudflare');
    vi.mocked(Sentry.captureMessage).mockClear();
    const shifted = SEGMENTS.map((segment) => ({ ...segment, text: `x${segment.text}` }));
    const { prompt } = await run({}, shifted);
    expect(prompt).not.toContain('[TIMELINE]');
    expect(vi.mocked(Sentry.captureMessage).mock.calls.some(([message]) => String(message).includes('do not align'))).toBe(true);
  });
});

// ─── #417 P1 segment-provenance guard ───────────────────────────────────────
// Contract: segmentsTrusted is true ONLY when resolvedSegments was assigned
// from the worker's own fetch/cache result (fetchTranscriptIfMissing). A
// request-supplied transcript short-circuits the fetch entirely, so
// req.segments survive with unsigned times — they must never drive
// [HH:MM:SS] markers (the HMAC v2 token signs only the slice
// sha256/startWord/endWord, not segment times) and never reach the shared
// `transcripts` row (video_id PK, cache poisoning across ALL users).
describe('analyze-llm-stream #417 segment provenance (route-level)', () => {
  const originalFetch = globalThis.fetch;
  let route: typeof import('../routes/analysis')['default'];
  let openRouterBodies: string[];
  let pending: Promise<unknown>[];

  beforeEach(async () => {
    openRouterBodies = [];
    pending = [];
    sharedFetchMock.mockClear();
    activeFetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === PLAN_URL) return Promise.resolve(new Response(JSON.stringify({ cached: true, plan: null }), { status: 200 }));
      if (url === OPENROUTER_URL) {
        openRouterBodies.push(String(init?.body ?? ''));
        return Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    globalThis.fetch = sharedFetch;
    route = (await import('../routes/analysis')).default;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(pending);
  });

  /** Body extras go in the request; cacheEnv enables the worker's cache path. */
  async function runProvenance(extra: Record<string, unknown>, cacheEnv?: { url: string; token: string }): Promise<{ prompt: string; persistBodies: Record<string, unknown>[] }> {
    const hash = await sliceDigest(TRANSCRIPT, 2, 6);
    const { sig, exp } = await signV2(2, 6, hash);
    // When the cache path supplies the transcript, the request must NOT carry
    // one (its presence short-circuits fetchTranscriptIfMissing entirely).
    const withTranscript = cacheEnv === undefined || extra.transcript !== undefined;
    const body: Record<string, unknown> = {
      videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'T', duration: 110 },
      sig, exp, models: [], cascade: CASCADE, dimensions: [1, 2, 3],
      tokenVersion: 2, streamCount: STREAM_COUNT, jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 1, bundleList: BUNDLE_LIST, sliceSha256: hash, startWord: 2, endWord: 6, ...extra,
    };
    if (withTranscript) body.transcript = extra.transcript ?? TRANSCRIPT;
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const env = { ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL, ...(cacheEnv ? { UPSTASH_REDIS_REST_URL: cacheEnv.url, UPSTASH_REDIS_REST_TOKEN: cacheEnv.token } : {}) };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    await res.text();
    await Promise.allSettled(pending);
    const orBody = JSON.parse(openRouterBodies[0] ?? '{}') as { messages?: Array<{ content: unknown }> };
    const prompt = (orBody.messages ?? [])
      .map((message) => (typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map((block: { text?: string }) => block.text ?? '').join('\n') : ''))
      .join('\n');
    const fetchMock = sharedFetchMock;
    const persistBodies = fetchMock.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .map((url: string, index: number) => (url.endsWith('/api/analyses/persist')
        ? JSON.parse(String(fetchMock.mock.calls[index][1]?.body ?? '{}')) as Record<string, unknown>
        : null))
      .filter((b: Record<string, unknown> | null): b is Record<string, unknown> => b !== null);
    return { prompt, persistBodies };
  }

  it('(untrusted-a) request carries transcript + altered-time segments, no worker fetch: plain text, no markers, persist OMITS segments (preserve-on-empty, /simplify)', async () => {
    const Sentry = await import('@sentry/cloudflare');
    vi.mocked(Sentry.captureMessage).mockClear();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // Times altered: same words as the transcript slice, shifted starts.
      const forged = SEGMENTS.map((segment) => ({ ...segment, start: segment.start + 12345 }));
      const { prompt, persistBodies } = await runProvenance({ segments: forged });
      expect(prompt).not.toContain('[TIMELINE]');
      expect(prompt).not.toContain('[00:');
      expect(prompt).toContain('two three four five');
      expect(persistBodies.length).toBeGreaterThan(0);
      // /simplify: segments are OMITTED (undefined), not [] — the persist
      // route's adapter rule preserves the stored row's segments/content.
      for (const body of persistBodies) {
        expect(body.segments).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(body, 'segments')).toBe(false);
      }
      // /simplify: request-supplied segments are never assigned to
      // resolvedSegments at all (trusted by construction), so the untrusted
      // case is now a silent plain-text fallback — no "untrusted" info crumb
      // AND no "do not align" warning (only WORKER-fetched segments that
      // misalign may fire that channel).
      const warning = vi.mocked(Sentry.captureMessage).mock.calls.find(([message]) => String(message).includes('do not align'));
      expect(warning).toBeUndefined();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('(trusted-b) worker cache returns segments (fetch/cache path): markers present and those segments persisted', async () => {
    // Upstash configured -> the route builds a cache adapter; the request
    // carries NO segments, so the ONLY source of markers is the worker's own
    // transcript-cache HIT (transcript:* entries are written exclusively from
    // the worker's own fetch results -> trusted by contract).
    const prevHandler = activeFetchHandler;
    activeFetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://cache.example.test/get/transcript:')) {
        return Promise.resolve(new Response(JSON.stringify({ result: JSON.stringify({ transcript: TRANSCRIPT, segments: SEGMENTS }) }), { status: 200 }));
      }
      return prevHandler(input, init);
    };
    const { prompt, persistBodies } = await runProvenance({}, { url: 'https://cache.example.test', token: 'tok' });
    expect(prompt).toContain('[TIMELINE]');
    expect(prompt).toContain('[00:00:20] two [00:00:30] three four five');
    expect(persistBodies.length).toBeGreaterThan(0);
    const segmentsPersisted = persistBodies.some((body) => Array.isArray(body.segments) && (body.segments as unknown[]).length > 0);
    expect(segmentsPersisted).toBe(true);
  });

  it('#417 P2: the transcript cache key is versioned (v2) so legacy entries without segment provenance miss', async () => {
    const { transcriptCacheKey } = await import('../routes/analysis');
    expect(transcriptCacheKey('abc123')).toBe('transcript:v2:abc123');
    expect(transcriptCacheKey('abc123')).not.toBe(`transcript:abc123`);
  });
});

describe('Phase 2.6 Route B: classification cell gets a clean transcript', () => {
  const originalFetch = globalThis.fetch;
  let route: typeof import('../routes/analysis')['default'];
  let openRouterBodies: string[];
  let pending: Promise<unknown>[];

  beforeEach(async () => {
    openRouterBodies = [];
    pending = [];
    sharedFetchMock.mockClear();
    activeFetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === PLAN_URL) return Promise.resolve(new Response(JSON.stringify({ cached: true, plan: null }), { status: 200 }));
      if (url === OPENROUTER_URL) {
        openRouterBodies.push(String(init?.body ?? ''));
        return Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']));
      }
      if (url.startsWith('https://cache.example.test/get/transcript:')) {
        // Trusted (#417): segments arrive via the worker's own cache hit, so
        // Route A WOULD annotate — RB-a proves Route B still sends clean text.
        return Promise.resolve(new Response(JSON.stringify({ result: JSON.stringify({ transcript: TRANSCRIPT, segments: SEGMENTS }) }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    globalThis.fetch = sharedFetch;
    route = (await import('../routes/analysis')).default;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(pending);
  });

  // The cell's signed bundle is chosen per test; transcript + segments come
  // from the worker cache (trusted path), never from the request.
  async function runWithBundle(bundle: number[]): Promise<string> {
    const bundleList = [bundle, ...BUNDLE_LIST.slice(1)];
    // Keep the structural stream-count invariant true: bundle 0's
    // grounded/projective class may change with the test bundle.
    const groundedBundles = bundleList.filter((b) => !isProjectiveBundle(b)).length;
    const routeStreamCount = JEV_CHUNK_COUNT * groundedBundles + (bundleList.length - groundedBundles);
    const hash = await sliceDigest(TRANSCRIPT, 2, 6);
    const prev = { secret: process.env.STREAM_HMAC_SECRET, nodeEnv: process.env.NODE_ENV };
    process.env.STREAM_HMAC_SECRET = SECRET;
    process.env.NODE_ENV = 'development';
    let sig: string; let exp: number;
    try {
      ({ sig, exp } = await (await import('../../../web/lib/stream-token')).signStreamTokenV2({
        videoId: VIDEO_ID, analysisId: ANALYSIS_ID, models: [], streamCount: routeStreamCount,
        jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT, chunkIndex: 1, bundleList,
        slice: { sha256: hash, startWord: 2, endWord: 6 },
      }));
    } finally {
      if (prev.secret === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev.secret;
      if (prev.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.nodeEnv;
    }
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'T', duration: 110 },
        sig, exp, models: [], cascade: CASCADE, dimensions: bundle,
        tokenVersion: 2, streamCount: routeStreamCount, jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 1, bundleList, sliceSha256: hash, startWord: 2, endWord: 6,
      }),
    });
    const env = { ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL, UPSTASH_REDIS_REST_URL: 'https://cache.example.test', UPSTASH_REDIS_REST_TOKEN: 'tok' };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    await res.text();
    const body = JSON.parse(openRouterBodies[0] ?? '{}') as { messages?: Array<{ content: unknown }> };
    return (body.messages ?? [])
      .map((message) => (typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map((block: { text?: string }) => block.text ?? '').join('\n') : ''))
      .join('\n');
  }

  it('(RB-a) a classification cell (dims incl. 11) sends CLEAN text even with trusted segments: no [HH:MM:SS], no [TIMELINE]', async () => {
    const prompt = await runWithBundle([9, 11]);
    expect(prompt).not.toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    expect(prompt).not.toContain('[TIMELINE]');
    expect(prompt).toContain('two three four five');
  });

  it('(RB-b) a grounded cell with the same trusted segments still gets markers (Route A unchanged)', async () => {
    const prompt = await runWithBundle([1, 2, 3]);
    expect(prompt).toContain('[TIMELINE]');
    expect(prompt).toMatch(/\[00:00:20\] two/);
  });
});

describe('needsCleanTranscript (unit)', () => {
  it('[9, 11] -> true (classification dimension present)', async () => {
    expect((await import('../services/TranscriptTimeMarkers')).needsCleanTranscript([9, 11])).toBe(true);
  });
  it('[1, 2] -> false', async () => {
    expect((await import('../services/TranscriptTimeMarkers')).needsCleanTranscript([1, 2])).toBe(false);
  });
  it('[] -> false', async () => {
    expect((await import('../services/TranscriptTimeMarkers')).needsCleanTranscript([])).toBe(false);
  });
});
