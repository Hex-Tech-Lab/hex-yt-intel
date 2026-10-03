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
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === PLAN_URL) return Promise.resolve(new Response(JSON.stringify({ cached: true, plan: null }), { status: 200 }));
      if (url === OPENROUTER_URL) {
        openRouterBodies.push(String(init?.body ?? ''));
        return Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;
    route = (await import('../routes/analysis')).default;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.allSettled(pending);
  });

  async function run(extra: Record<string, unknown>): Promise<{ prompt: string; raw: string }> {
    const hash = await sliceDigest(TRANSCRIPT, 2, 6);
    const { sig, exp } = await signV2(2, 6, hash);
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'T', duration: 110 },
        transcript: TRANSCRIPT, sig, exp, models: [], cascade: CASCADE, dimensions: [1, 2, 3],
        tokenVersion: 2, streamCount: STREAM_COUNT, jevChunkIndex: 0, jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 1, bundleList: BUNDLE_LIST, sliceSha256: hash, startWord: 2, endWord: 6, ...extra,
      }),
    });
    const env = { ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(openRouterBodies[0] ?? '{}') as { messages?: Array<{ content: unknown }> };
    const prompt = (body.messages ?? [])
      .map((message) => (typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map((block: { text?: string }) => block.text ?? '').join('\n') : ''))
      .join('\n');
    return { prompt, raw };
  }

  it('(f) a v2 cell reads REAL absolute times from the segments, never restarting at 00:00:00', async () => {
    const { prompt } = await run({ segments: SEGMENTS });
    expect(prompt).toContain('[TIMELINE] This transcript excerpt covers 00:00:20–00:01:00 of a 00:01:50 video.');
    expect(prompt).toContain('[00:00:20] two [00:00:30] three four five');
    expect(prompt).not.toContain('[00:00:00]');
  });

  it('(g) the truncation warning measures the CELL\'s plain words — not the whole video, not the markers', async () => {
    // Budget 40 chars: the full transcript (53) is over it; the 4-word slice
    // (19 chars) is not, even though its annotated text (header + markers) is.
    const { raw, prompt } = await run({ transcriptBudgetChars: 40, segments: SEGMENTS });
    expect(raw).not.toContain('transcript-truncated');
    expect(prompt).toContain('[00:00:20] two [00:00:30] three four five');
    expect(prompt).not.toContain('excerpt truncated');
  });

  it('(h) a budget that cuts the cell: plain words decide the cut, the visible range is stated, no mid-marker cut', async () => {
    // "two three" = 9 chars fits a 12-char budget; "two three four" (14) does not.
    const { raw, prompt } = await run({ transcriptBudgetChars: 12, segments: SEGMENTS });
    expect(raw).toContain('transcript-truncated');
    expect(prompt).toContain('covers 00:00:20–00:00:40'); // "three" segment 30 s + 10 s
    expect(prompt).toContain('[00:00:20] two [00:00:30] three');
    expect(prompt).not.toContain('three four'); // the cut word never reaches the model
    expect(prompt).toContain('excerpt truncated to fit the prompt budget');
  });

  it('(i) raw whitespace never fakes a truncation: the warning follows the annotator\'s word-joined cut', async () => {
    const spaced = TRANSCRIPT.split(' ').join('  '); // 63 raw chars, 53 single-space-joined
    const exp = Date.now() + 60_000;
    const sig = await hmacHex(SECRET, `${VIDEO_ID}:${ANALYSIS_ID}:${exp}:`);
    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID, analysisId: ANALYSIS_ID, metadata: { title: 'T', duration: 110 },
        transcript: spaced, segments: SEGMENTS, sig, exp, models: [], cascade: CASCADE, dimensions: [1, 2, 3],
        transcriptBudgetChars: 55,
      }),
    });
    const env = { ENVIRONMENT: 'test', STREAM_HMAC_SECRET: SECRET, OPENROUTER_API_KEY: 'k', APP_URL };
    const res = await route.request(req, undefined, env, { waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext);
    const raw = await res.text();
    expect(raw).not.toContain('transcript-truncated');
  });
});

