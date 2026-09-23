/**
 * Unit tests for the extracted chapter-persist S2S block
 * (worker/src/services/chapter-persist.ts), formerly inline in
 * routes/analysis.ts.
 *
 * Contract under test (2026-09-24 round-2 review):
 * - Gate is BUNDLE-1-AUTHORITATIVE: persist iff chunkIndex is undefined
 *   (stale client) or 1. Bundles 2..N and any other value (incl. 0/null)
 *   must not fire a POST (old behavior: ALL 5 bundles persisted).
 * - No description → never fires.
 * - Non-2xx response → Sentry.captureMessage with status + BOUNDED
 *   bodySnippet (≤ CHAPTER_PERSIST_BODY_SNIPPET_MAX + '...' suffix).
 * - Rejected fetch/timeout → Sentry.captureException, no double-reporting
 *   (non-2xx path never also fires captureException and vice versa).
 *
 * Negative control: the old inline code had no gate at all, so the
 * "bundle 2 does not fire" assertions below fail against pre-fix behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());
vi.mock('@sentry/cloudflare', () => ({ captureMessage, captureException }));

import {
  shouldPersistChaptersForChunk,
  truncateBodySnippet,
  CHAPTER_PERSIST_BODY_SNIPPET_MAX,
  enqueueChapterPersist,
} from '../services/chapter-persist';

const BASE_DEPS = {
  description: '0:00 Intro\n5:00 Deep dive',
  chunkIndex: 1 as number | undefined,
  signingKey: 'test-secret',
  appUrl: 'https://getvintel.com',
  videoId: '4mTLpuQpB80',
  waitUntil: (promise: Promise<unknown>) => { void promise; },
};

function collectWaitUntil(): { promises: Promise<unknown>[]; deps: typeof BASE_DEPS } {
  const promises: Promise<unknown>[] = [];
  const deps = { ...BASE_DEPS, waitUntil: (promise: Promise<unknown>) => { promises.push(promise); } };
  return { promises, deps };
}

describe('shouldPersistChaptersForChunk (bundle-1-authoritative gate)', () => {
  it('persists for bundle 1', () => {
    expect(shouldPersistChaptersForChunk(1)).toBe(true);
  });

  it('does NOT persist for bundles 2..5', () => {
    for (const n of [2, 3, 4, 5]) {
      expect(shouldPersistChaptersForChunk(n)).toBe(false);
    }
  });

  it('preserves always-persist behavior for stale clients (undefined chunkIndex)', () => {
    expect(shouldPersistChaptersForChunk(undefined)).toBe(true);
  });

  it('does NOT persist for 0 or null-ish values (not valid bundle ids)', () => {
    expect(shouldPersistChaptersForChunk(0)).toBe(false);
    expect(shouldPersistChaptersForChunk(null as unknown as undefined)).toBe(false);
  });
});

describe('truncateBodySnippet (P2: strictly bounded, response body only)', () => {
  it('returns short bodies verbatim', () => {
    expect(truncateBodySnippet('Unauthorized')).toBe('Unauthorized');
  });

  it('truncates oversized bodies to the cap + ellipsis', () => {
    const oversized = 'x'.repeat(10_000);
    const snippet = truncateBodySnippet(oversized);
    expect(snippet.length).toBe(CHAPTER_PERSIST_BODY_SNIPPET_MAX + 3);
    expect(snippet.endsWith('...')).toBe(true);
  });
});

describe('enqueueChapterPersist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('bundle 1 fires exactly one signed POST', async () => {
    const { promises, deps } = collectWaitUntil();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    enqueueChapterPersist({ ...deps, fetchFn: fetchMock });
    expect(promises).toHaveLength(1);
    await promises[0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://getvintel.com/api/videos/4mTLpuQpB80/chapters');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string) as { sig: string; exp: number; chapters: unknown[] };
    expect(body.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('bundles 2..5 never fire a POST (negative control: old code fired on all bundles)', () => {
    for (const chunkIndex of [2, 3, 4, 5]) {
      const { promises, deps } = collectWaitUntil();
      const fetchMock = vi.fn();
      enqueueChapterPersist({ ...deps, chunkIndex, fetchFn: fetchMock });
      expect(promises).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('undefined chunkIndex (stale client) still fires', async () => {
    const { promises, deps } = collectWaitUntil();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    enqueueChapterPersist({ ...deps, chunkIndex: undefined, fetchFn: fetchMock });
    expect(promises).toHaveLength(1);
    await promises[0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no description → never fires', () => {
    const { promises, deps } = collectWaitUntil();
    const fetchMock = vi.fn();
    enqueueChapterPersist({ ...deps, description: undefined, fetchFn: fetchMock });
    expect(promises).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing signing key → never fires', () => {
    const { promises, deps } = collectWaitUntil();
    const fetchMock = vi.fn();
    enqueueChapterPersist({ ...deps, signingKey: '', fetchFn: fetchMock });
    expect(promises).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-2xx → Sentry.captureMessage with status and BOUNDED snippet; no captureException', async () => {
    const { promises, deps } = collectWaitUntil();
    const oversizedBody = JSON.stringify({ error: 'Unauthorized', details: 'y'.repeat(5_000) });
    const fetchMock = vi.fn().mockResolvedValue(new Response(oversizedBody, { status: 401 }));
    enqueueChapterPersist({ ...deps, fetchFn: fetchMock });
    await promises[0];
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const extra = captureMessage.mock.calls[0][1].extra as { videoId: string; status: number; bodySnippet: string };
    expect(extra.status).toBe(401);
    expect(extra.videoId).toBe('4mTLpuQpB80');
    expect(extra.bodySnippet.length).toBe(CHAPTER_PERSIST_BODY_SNIPPET_MAX + 3);
    expect(extra.bodySnippet.endsWith('...')).toBe(true);
    // No auth headers / signed request payload / cookies can appear: the
    // snippet is derived solely from the endpoint's response body.
    expect(extra.bodySnippet).not.toContain('sig');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('rejected fetch → Sentry.captureException; no double-reporting', async () => {
    const { promises, deps } = collectWaitUntil();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network reset'));
    enqueueChapterPersist({ ...deps, fetchFn: fetchMock });
    await promises[0];
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(captureException.mock.calls[0][0].message).toBe('network reset');
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
