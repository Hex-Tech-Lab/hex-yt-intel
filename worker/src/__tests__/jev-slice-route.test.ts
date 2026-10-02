/**
 * R3b 2.3.5d route-level tests: worker transcript slice enforcement with K=1 fallback.
 *
 * Contract under test (ADR 037 2.3.5):
 *   (a) v1 request -> OpenRouter receives the full transcript unchanged.
 *   (b) v2 grounded, matching hash -> OpenRouter receives exactly the slice words.
 *   (c) v2 grounded, wrong hash -> full transcript + exactly one jev-fallback frame + Sentry called.
 *   (d) v2 grounded, endWord past the end -> same as (c) with slice_out_of_range.
 *   (e) v2 projective -> full transcript unchanged.
 */
import * as Sentry from '@sentry/cloudflare';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isProjectiveBundle } from '../../../web/lib/config/synthesis';
import { hmacHex } from '../crypto';
import {
  tokenizeTranscript,
  sliceText,
  sliceDigest,
  EMPTY_SLICE_SHA256,
} from '../services/TranscriptSlice';

vi.mock('@sentry/cloudflare', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const VIDEO_ID = 'vid123';
const TRANSCRIPT = 'zero one two three four five six seven eight nine ten';
const APP_URL = 'https://app.example.test';
const PLAN_URL = `${APP_URL}/api/analyses/${ANALYSIS_ID}/plan`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DELTA_TOKEN = 'HELLO_GROUNDED_TOKEN';

const CASCADE = [{ model: 'anthropic/claude-haiku-4.5', name: 'Haiku 4.5', providerOrder: ['anthropic'] }];

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

function makePlan() {
  return {
    K: 2,
    streamCount: STREAM_COUNT,
    cells: [{ jevChunkIndex: 0, chunkIndex: 1, startWord: 0, endWord: 3, sha256: 'aa'.repeat(32) }],
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

function makeEnv() {
  return {
    ENVIRONMENT: 'test',
    STREAM_HMAC_SECRET: SECRET,
    OPENROUTER_API_KEY: 'test-openrouter-key',
    APP_URL: APP_URL,
  };
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

function extractFallbackFrames(frames: Array<{ event?: string; data: string }>) {
  return frames.filter((f) => {
    if (f.event) return false;
    try {
      const parsed = JSON.parse(f.data);
      return parsed.type === 'status' && parsed.stage === 'jev-fallback';
    } catch (parseErr) {
      console.warn('[jev-slice-route-test] Frame data parse failed:', parseErr);
      return false;
    }
  });
}

async function signV2Token(params: {
  models?: string[];
  streamCount: number;
  jevChunkIndex: number;
  jevChunkCount: number;
  chunkIndex: number;
  bundleList: number[][];
  slice: { sha256: string; startWord: number; endWord: number };
}): Promise<{ sig: string; exp: number }> {
  const { signStreamTokenV2 } = await import('../../../web/lib/stream-token');
  const prevSecret = process.env.STREAM_HMAC_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.STREAM_HMAC_SECRET = SECRET;
  process.env.NODE_ENV = 'development';
  try {
    return await signStreamTokenV2({
      videoId: VIDEO_ID,
      analysisId: ANALYSIS_ID,
      models: params.models ?? [],
      streamCount: params.streamCount,
      jevChunkIndex: params.jevChunkIndex,
      jevChunkCount: params.jevChunkCount,
      chunkIndex: params.chunkIndex,
      bundleList: params.bundleList,
      slice: params.slice,
    });
  } finally {
    if (prevSecret === undefined) delete process.env.STREAM_HMAC_SECRET;
    else process.env.STREAM_HMAC_SECRET = prevSecret;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
}

describe('analyze-llm-stream transcript slice enforcement (R3b 2.3.5d route-level)', () => {
  const originalFetch = globalThis.fetch;
  let analysisRoute: typeof import('../routes/analysis')['default'];
  let fetchLog: FetchLog[];
  let waitUntilPromises: Promise<unknown>[] = [];

  beforeEach(async () => {
    fetchLog = [];
    waitUntilPromises = [];
    vi.clearAllMocks();

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

  async function executeRequest(req: Request): Promise<{ frames: Array<{ event?: string; data: string }>; openRouterBody: any }> {
    const waitUntil = (promiseTask: Promise<unknown>) => {
      waitUntilPromises.push(promiseTask);
    };
    const res = await analysisRoute.request(req, undefined, makeEnv(), { waitUntil } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const orCall = fetchLog.find((c) => c.url === OPENROUTER_URL);
    expect(orCall).toBeDefined();
    const openRouterBody = orCall?.init?.body ? JSON.parse(orCall.init.body as string) : null;
    return { frames, openRouterBody };
  }

  function getPromptContent(openRouterBody: any): string {
    const messages = openRouterBody?.messages;
    if (Array.isArray(messages)) {
      return messages
        .map((m: any) => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) {
            return m.content.map((b: any) => (typeof b.text === 'string' ? b.text : '')).join('\n');
          }
          return '';
        })
        .join('\n');
    }
    return '';
  }

  it('(a) v1 request -> OpenRouter receives the full transcript', async () => {
    const exp = Date.now() + 60_000;
    const models: string[] = [];
    const sig = await hmacHex(SECRET, `${VIDEO_ID}:${ANALYSIS_ID}:${exp}:${models.sort().join(',')}`);

    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        sig,
        exp,
        models,
        cascade: CASCADE,
        dimensions: [1, 2, 3],
      }),
    });

    const { frames, openRouterBody } = await executeRequest(req);
    const prompt = getPromptContent(openRouterBody);
    expect(prompt).toContain(TRANSCRIPT);

    const fallbackFrames = extractFallbackFrames(frames);
    expect(fallbackFrames).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('(b) v2 grounded, matching hash -> OpenRouter receives exactly the slice words', async () => {
    const startWord = 2;
    const endWord = 6;
    const hash = await sliceDigest(TRANSCRIPT, startWord, endWord);
    const { sig, exp } = await signV2Token({
      streamCount: STREAM_COUNT,
      jevChunkIndex: 0,
      jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 1,
      bundleList: BUNDLE_LIST,
      slice: { sha256: hash, startWord, endWord },
    });

    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        sig,
        exp,
        models: [],
        cascade: CASCADE,
        dimensions: [1, 2, 3],
        tokenVersion: 2,
        streamCount: STREAM_COUNT,
        jevChunkIndex: 0,
        jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 1,
        bundleList: BUNDLE_LIST,
        sliceSha256: hash,
        startWord,
        endWord,
      }),
    });

    const { frames, openRouterBody } = await executeRequest(req);
    const prompt = getPromptContent(openRouterBody);

    expect(prompt).toContain(`**Transcript**:\ntwo three four five`);
    expect(prompt).not.toContain(TRANSCRIPT);
    expect(prompt).not.toContain('zero one');
    expect(prompt).not.toContain('eight nine ten');

    const fallbackFrames = extractFallbackFrames(frames);
    expect(fallbackFrames).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('(c) v2 grounded, wrong hash -> full transcript + exactly one jev-fallback frame + Sentry called', async () => {
    const startWord = 0;
    const endWord = 4;
    const bogusHash = 'ee'.repeat(32);
    const { sig, exp } = await signV2Token({
      streamCount: STREAM_COUNT,
      jevChunkIndex: 0,
      jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 1,
      bundleList: BUNDLE_LIST,
      slice: { sha256: bogusHash, startWord, endWord },
    });

    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        sig,
        exp,
        models: [],
        cascade: CASCADE,
        dimensions: [1, 2, 3],
        tokenVersion: 2,
        streamCount: STREAM_COUNT,
        jevChunkIndex: 0,
        jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 1,
        bundleList: BUNDLE_LIST,
        sliceSha256: bogusHash,
        startWord,
        endWord,
      }),
    });

    const { frames, openRouterBody } = await executeRequest(req);
    const prompt = getPromptContent(openRouterBody);
    expect(prompt).toContain(TRANSCRIPT);

    const fallbackFrames = extractFallbackFrames(frames);
    expect(fallbackFrames).toHaveLength(1);
    expect(JSON.parse(fallbackFrames[0]!.data)).toEqual({
      type: 'status',
      stage: 'jev-fallback',
      reason: 'slice_hash_mismatch',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'jev slice hash mismatch; falling back to full transcript',
      expect.objectContaining({
        level: 'warning',
        tags: { operation: 'jev-slice-verify', reason: 'slice_hash_mismatch' },
        extra: {
          analysisId: ANALYSIS_ID,
          chunkIndex: 1,
          jevChunkIndex: 0,
          startWord,
          endWord,
          expectedSha256: bogusHash,
          // The digest the worker actually computed: a real sha256, not the signed one.
          computedSha256: expect.stringMatching(/^(?!(?:ee){32}$)[0-9a-f]{64}$/),
        },
      }),
    );
  });

  it('(d) v2 grounded, endWord past the end -> full transcript + exactly one jev-fallback frame (slice_out_of_range) + Sentry called', async () => {
    const startWord = 0;
    const endWord = 100;
    const bogusHash = 'ff'.repeat(32);
    const { sig, exp } = await signV2Token({
      streamCount: STREAM_COUNT,
      jevChunkIndex: 0,
      jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 1,
      bundleList: BUNDLE_LIST,
      slice: { sha256: bogusHash, startWord, endWord },
    });

    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        sig,
        exp,
        models: [],
        cascade: CASCADE,
        dimensions: [1, 2, 3],
        tokenVersion: 2,
        streamCount: STREAM_COUNT,
        jevChunkIndex: 0,
        jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 1,
        bundleList: BUNDLE_LIST,
        sliceSha256: bogusHash,
        startWord,
        endWord,
      }),
    });

    const { frames, openRouterBody } = await executeRequest(req);
    const prompt = getPromptContent(openRouterBody);
    expect(prompt).toContain(TRANSCRIPT);

    const fallbackFrames = extractFallbackFrames(frames);
    expect(fallbackFrames).toHaveLength(1);
    expect(JSON.parse(fallbackFrames[0]!.data)).toEqual({
      type: 'status',
      stage: 'jev-fallback',
      reason: 'slice_out_of_range',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'jev slice hash mismatch; falling back to full transcript',
      expect.objectContaining({
        level: 'warning',
        tags: { operation: 'jev-slice-verify', reason: 'slice_out_of_range' },
        extra: {
          analysisId: ANALYSIS_ID,
          chunkIndex: 1,
          jevChunkIndex: 0,
          startWord,
          endWord,
          expectedSha256: bogusHash,
          computedSha256: null,
        },
      }),
    );
  });

  it('(e) v2 projective -> full transcript unchanged', async () => {
    const startWord = 0;
    const endWord = 0;
    const sliceSha256 = EMPTY_SLICE_SHA256;
    const { sig, exp } = await signV2Token({
      streamCount: STREAM_COUNT,
      jevChunkIndex: 0,
      jevChunkCount: JEV_CHUNK_COUNT,
      chunkIndex: 5,
      bundleList: BUNDLE_LIST,
      slice: { sha256: sliceSha256, startWord, endWord },
    });

    const req = new Request(`${APP_URL}/analyze-llm-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        analysisId: ANALYSIS_ID,
        metadata: { title: 'Test Video', duration: 60 },
        transcript: TRANSCRIPT,
        sig,
        exp,
        models: [],
        cascade: CASCADE,
        dimensions: [9, 11],
        tokenVersion: 2,
        streamCount: STREAM_COUNT,
        jevChunkIndex: 0,
        jevChunkCount: JEV_CHUNK_COUNT,
        chunkIndex: 5,
        bundleList: BUNDLE_LIST,
        sliceSha256,
        startWord,
        endWord,
      }),
    });

    const { frames, openRouterBody } = await executeRequest(req);
    const prompt = getPromptContent(openRouterBody);
    expect(prompt).toContain(TRANSCRIPT);

    const fallbackFrames = extractFallbackFrames(frames);
    expect(fallbackFrames).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
