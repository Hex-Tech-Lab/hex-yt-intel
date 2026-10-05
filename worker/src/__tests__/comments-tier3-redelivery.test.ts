/**
 * CONTRACT (dispatch brief 2026-10-05 T1, findings A+B): Cloudflare Queues is
 * at-least-once, so the Tier 3 consumer (1) probes the run row's status via a
 * SIGNED GET before ANY paid fetch/classify work and acks with zero work when
 * the run already progressed (sampling/completed), (2) proceeds on
 * pending/failed, (3) fails CLOSED when the status cannot be determined
 * (rethrow -> worker.ts queue handler -> message.retry()), and (4) retries
 * the persist-sample-run write (2 retries, ~1s/~2s backoff) and, on total
 * failure of the terminal success report, reports the run failed best-effort
 * with a Sentry capture (comments_tier3_persist_sample_run) so the run never
 * sits in 'sampling' until stale-release.
 *
 * Stubbed YouTube (fetchCommentsPage) + stubbed Jev classifier + stubbed
 * global fetch; no network.
 */
import * as Sentry from '@sentry/cloudflare';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalJson } from '../../../web/lib/utils/canonical-json';
import { verifyContentSig } from '../../../web/lib/stream-token';
import { handleCommentsTier3Message } from '../queue-consumers/comments-tier3';
import type { VideoComment } from '../ports/CommentIngestionPort';
import type { CommentsTier3QueueMessage } from '../routes/comments';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../services/JevCommentClassifier', () => ({
  JevCommentClassifier: class {
    classifyBatchWithCost = classifierMock;
  },
}));
vi.mock('../services/MetadataScraper', () => ({
  MetadataScraper: class {
    fetchCommentsPage: FetchPage;
    constructor() {
      this.fetchCommentsPage = (nextScraperStub?.fetchCommentsPage ?? (vi.fn() as unknown as FetchPage)) as FetchPage;
      scraperInstances.push(this);
    }
  },
}));

type FetchPage = ReturnType<typeof vi.fn>;
const scraperInstances: Array<{ fetchCommentsPage: FetchPage }> = [];
/** Set before each test; the mocked constructor hands out this stub. */
let nextScraperStub: { fetchCommentsPage: FetchPage } | null = null;

const globalFetch = vi.fn();
let classifierMock: ReturnType<typeof vi.fn>;

const SAMPLING = {
  syncPoolMaxPages: 2,
  recencyPoolMaxPages: 2,
  likeBucketCount: 3,
  recencyBucketCount: 3,
  cochran: { zScore: 1.96, marginOfError: 0.05, pEstimate: 0.5 },
  minConfidence: 0.5,
  classifierConcurrency: 2,
  classifierRequestTimeoutMs: 5000,
};

function makeMessage(overrides: Partial<CommentsTier3QueueMessage> = {}): CommentsTier3QueueMessage {
  return {
    sampleRunId: '5f0c2b3a-0000-4000-8000-000000000001',
    videoId: 'vid123',
    userId: '5f0c2b3a-0000-4000-8000-000000000002',
    totalCommentCount: 500,
    appUrl: 'https://app.test',
    mode: 'cochran',
    sampling: SAMPLING,
    ...overrides,
  };
}

const ENV = {
  YOUTUBE_API_KEY: 'yt-key',
  OPENROUTER_API_KEY: 'or-key',
  STREAM_HMAC_SECRET: 'hmac-secret',
  APP_URL: 'https://app.test',
};

function stubPool(externalIds: string[]): Array<{ comments: VideoComment[]; exhausted: boolean; nextPageToken?: string }> {
  const comments = externalIds.map((id) => ({
    externalId: id,
    author: `a-${id}`,
    text: `t-${id}`,
    likeCount: 1,
    publishedAt: '2026-09-01T00:00:00Z',
  }));
  return [{ comments, exhausted: true }];
}

/** Serves the status probe via GET and POST attempts per a per-call script. */
type PostScript = (postCall: number) => Response;
function stubFetch(probeStatus: number | { status: string }, postScript: PostScript = () => new Response('{}', { status: 200 })): void {
  let postCall = 0;
  globalFetch.mockImplementation((unusedUrl: RequestInfo | URL, init?: RequestInit) => {
    if ((init as { method?: string } | undefined)?.method === 'GET') {
      const status = typeof probeStatus === 'number' ? probeStatus : 200;
      const body = typeof probeStatus === 'number' ? '{}' : JSON.stringify(probeStatus);
      return Promise.resolve(new Response(body, { status }));
    }
    postCall += 1;
    return Promise.resolve(postScript(postCall));
  });
}

function callsByMethod(): { gets: Array<[RequestInfo | URL, RequestInit | undefined]>; posts: Array<[RequestInfo | URL, RequestInit | undefined]> } {
  const gets: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const posts: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  for (const call of globalFetch.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>) {
    if (call[1]?.method === 'GET') gets.push(call);
    else if (call[1]?.method === 'POST') posts.push(call);
  }
  return { gets, posts };
}

function postBodies(): Array<Record<string, unknown>> {
  return callsByMethod().posts.map(([, init]) => JSON.parse((init as { body: string }).body));
}

beforeEach(() => {
  scraperInstances.length = 0;
  nextScraperStub = null;
  globalFetch.mockReset();
  vi.stubGlobal('fetch', globalFetch);
  classifierMock = vi.fn();
  classifierMock.mockResolvedValue({ results: [], costUsd: 0, failedCount: 0 });
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
  // The web verifier reads the shared secret from process.env at call time.
  process.env.STREAM_HMAC_SECRET = ENV.STREAM_HMAC_SECRET;
});

describe('handleCommentsTier3Message — redelivery pre-check (Finding A)', () => {
  it.each(['sampling', 'completed'] as const)('run already %s -> ack with ZERO work (no scraper, no classifier, no write)', async (priorStatus) => {
    stubFetch({ status: priorStatus });

    await handleCommentsTier3Message(makeMessage(), ENV);

    const { gets, posts } = callsByMethod();
    expect(gets).toHaveLength(1); // exactly the status probe
    expect(String(gets[0]?.[0])).toContain('/api/comments/persist-sample-run');
    expect(posts).toHaveLength(0); // no heartbeat, no terminal report
    expect(scraperInstances).toHaveLength(0); // no YouTube fetch at all
    expect(classifierMock).not.toHaveBeenCalled(); // no LLM spend
  });

  it.each(['pending', 'failed'] as const)('run status %s -> proceeds with the full pipeline', async (priorStatus) => {
    stubFetch({ status: priorStatus });
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    scraperStub.fetchCommentsPage.mockResolvedValue(stubPool(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'])[0]);

    await handleCommentsTier3Message(makeMessage(), ENV);

    const orders = scraperStub.fetchCommentsPage.mock.calls.map((call) => (call[1] as { order?: string }).order);
    expect(orders).toContain('relevance');
    expect(orders).toContain('time');
    const statuses = postBodies().map((body) => body.status);
    expect(statuses[0]).toBe('sampling');
    expect(statuses[statuses.length - 1]).toBe('completed');
  });

  it('row missing (404) -> Sentry.captureMessage + ack with zero work (no retry spin)', async () => {
    stubFetch(404);

    await handleCommentsTier3Message(makeMessage(), ENV);

    expect(callsByMethod().posts).toHaveLength(0);
    expect(scraperInstances).toHaveLength(0);
    expect(classifierMock).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('status probe fails (500) -> fail-closed: handler throws, captureException, zero paid work', async () => {
    stubFetch(500);

    await expect(handleCommentsTier3Message(makeMessage(), ENV)).rejects.toThrow('sample-run status probe non-ok: 500');

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(scraperInstances).toHaveLength(0);
    expect(classifierMock).not.toHaveBeenCalled();
    expect(callsByMethod().posts).toHaveLength(0);
  });

  it('probe signature verifies against the REAL web verifier (cross-boundary bound-content layout)', async () => {
    stubFetch({ status: 'sampling' });

    await handleCommentsTier3Message(makeMessage(), ENV);

    const [probeUrl] = callsByMethod().gets[0] ?? [];
    expect(probeUrl).toBeDefined();
    const url = new URL(String(probeUrl));
    const sampleRunId = url.searchParams.get('sampleRunId');
    const userId = url.searchParams.get('userId');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig');
    expect(sampleRunId).toBeTruthy();
    expect(userId).toBeTruthy();
    expect(Number.isFinite(exp)).toBe(true);
    expect(sig).toBeTruthy();
    const ok = await verifyContentSig(
      canonicalJson({ sampleRunId, userId }),
      sig as string,
      { purpose: 'comments-tier3', id: sampleRunId as string, exp },
    );
    expect(ok).toBe(true);
  });
});

describe('handleCommentsTier3Message — persist-sample-run failure hardening (Finding B)', () => {
  it('persist write fails once then succeeds on retry -> single logical persist (one 200 completed report)', async () => {
    stubFetch({ status: 'pending' }, (postCall) => (postCall === 2 ? new Response('{}', { status: 500 }) : new Response('{}', { status: 200 })));
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    scraperStub.fetchCommentsPage.mockResolvedValue(stubPool(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'])[0]);

    // Real timers: the ~1s backoff is slept for real; assertions are
    // call-sequence-based, never wall-clock-based. (undici Response body
    // reads starve under vitest fake timers — verified empirically.)
    await handleCommentsTier3Message(makeMessage(), ENV);

    const bodies = postBodies();
    expect(bodies.map((body) => body.status)).toEqual(['sampling', 'completed', 'completed']);
    // The retry re-sent the SAME logical write (identical status + count):
    // only one of them (the 200) actually persisted server-side.
    expect(bodies[1]?.sampledCount).toBe(bodies[2]?.sampledCount);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('persist write fails ALL attempts -> one best-effort failed report + Sentry capture with the phase tag', async () => {
    stubFetch({ status: 'pending' }, (postCall) => (postCall === 1 || postCall >= 5 ? new Response('{}', { status: 200 }) : new Response('{}', { status: 500 })));
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    scraperStub.fetchCommentsPage.mockResolvedValue(stubPool(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'])[0]);

    // Real timers (see above): heartbeat 200, completed 500 x3 (initial +
    // 2 retries, ~1s + ~2s sleeps), best-effort failed report 200.
    await handleCommentsTier3Message(makeMessage(), ENV);

    const bodies = postBodies();
    expect(bodies.map((body) => body.status)).toEqual(['sampling', 'completed', 'completed', 'completed', 'failed']);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { operation: 'comments_tier3_persist_sample_run' } }),
    );
  });
});
