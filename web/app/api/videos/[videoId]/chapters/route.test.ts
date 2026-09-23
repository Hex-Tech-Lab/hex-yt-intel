/**
 * Route-boundary integration test for POST /api/videos/[videoId]/chapters
 * (round-2 review P1, PR #320): the middleware now EXEMPTS this route from
 * the session gate (the worker's cookie-less S2S call was 401'ing here since
 * PR #206), so the route's own HMAC gate (verifyContentSig, purpose
 * 'chapters') is the ONLY auth boundary. Pinned here:
 * - valid signed POST persists via upsertChapters;
 * - missing / invalid / expired / wrong-purpose signatures all rejected 401;
 * - malformed payload rejected 400 before any signature check;
 * - (GET session-gating + nested-path traversal rejection are pinned at the
 *   middleware layer in web/middleware.test.ts, kept focused there.)
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertChapters = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@/lib/env', () => ({
  env: { streamHmacSecret: 'test-hmac-secret', isProduction: false },
}));
vi.mock('@/lib/adapters/SupabaseTranscriptAdapter', () => ({
  SupabaseTranscriptAdapter: { upsertChapters },
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }));

import { boundContentMessage } from '@/lib/stream-token';
import { POST } from '@/app/api/videos/[videoId]/chapters/route';

const VIDEO_ID = '4mTLpuQpB80';
const SECRET = 'test-hmac-secret';

const CHAPTERS = [
  { idx: 0, start_seconds: 0, end_seconds: 60, label: 'Intro' },
  { idx: 1, start_seconds: 60, end_seconds: 300, label: 'Deep dive' },
];

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeSignedRequest(
  chapters: typeof CHAPTERS,
  opts: { purpose?: 'chapters' | 'persist'; exp?: number; omitSig?: boolean } = {},
): Promise<Response> {
  const canonical = JSON.stringify({ chapters });
  const exp = opts.exp ?? Date.now() + 60_000;
  const sig = opts.omitSig ? undefined : await hmacHex(SECRET, boundContentMessage(opts.purpose ?? 'chapters', VIDEO_ID, exp, canonical));
  const body = opts.omitSig ? { chapters, exp } : { chapters, sig, exp };
  return new NextRequest(`http://localhost/api/videos/${VIDEO_ID}/chapters`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ videoId: VIDEO_ID });

describe('POST /api/videos/[videoId]/chapters (route-boundary HMAC contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertChapters.mockResolvedValue(undefined);
  });

  it('valid signed POST persists chapters and returns inserted count', async () => {
    const res = await POST(await makeSignedRequest(CHAPTERS), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, inserted: 2 });
    expect(upsertChapters).toHaveBeenCalledWith(VIDEO_ID, CHAPTERS.map((c) => ({ video_id: VIDEO_ID, ...c })), { attemptedButEmpty: false });
  });

  it('missing signature is rejected 400 (schema boundary, before HMAC) and nothing persists', async () => {
    const res = await POST(await makeSignedRequest(CHAPTERS, { omitSig: true }), { params });
    expect(res.status).toBe(400);
    expect(upsertChapters).not.toHaveBeenCalled();
  });

  it('invalid signature (wrong secret) is rejected 401', async () => {
    const canonical = JSON.stringify({ chapters: CHAPTERS });
    const exp = Date.now() + 60_000;
    const wrongSig = await hmacHex('not-the-secret', boundContentMessage('chapters', VIDEO_ID, exp, canonical));
    const req = new NextRequest(`http://localhost/api/videos/${VIDEO_ID}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ chapters: CHAPTERS, sig: wrongSig, exp }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(upsertChapters).not.toHaveBeenCalled();
  });

  it('expired signature is rejected 401', async () => {
    const res = await POST(await makeSignedRequest(CHAPTERS, { exp: Date.now() - 1_000 }), { params });
    expect(res.status).toBe(401);
    expect(upsertChapters).not.toHaveBeenCalled();
  });

  it('wrong-purpose signature (replayed persist sig) is rejected 401', async () => {
    const res = await POST(await makeSignedRequest(CHAPTERS, { purpose: 'persist' }), { params });
    expect(res.status).toBe(401);
    expect(upsertChapters).not.toHaveBeenCalled();
  });

  it('malformed payload is rejected 400 before any signature check', async () => {
    const req = new NextRequest(`http://localhost/api/videos/${VIDEO_ID}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ chapters: 'not-an-array', sig: 'x', exp: Date.now() }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    expect(upsertChapters).not.toHaveBeenCalled();
  });
});
