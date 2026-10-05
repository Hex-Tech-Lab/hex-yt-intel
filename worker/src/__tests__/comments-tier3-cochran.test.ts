/**
 * CONTRACT (Comments Dispatch A, 2026-09-30): in mode='cochran' the Tier 3
 * consumer (1) requests BOTH orders — a relevance pool and a time pool, (2)
 * flips the run status pending -> sampling -> completed, (3) counts failed
 * classifications in insights.failed but stores NO row for them, and (4)
 * fails the run loudly (status='failed') when a sampling config value is
 * missing — it never invents defaults silently.
 *
 * Stubbed YouTube (fetchCommentsPage) + stubbed Jev classifier; no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../services/JevCommentClassifier', () => ({
  JevCommentClassifier: class {
    classifyBatchWithCost = classifierMock;
  },
}));

import { handleCommentsTier3Message, type CochranPersistPayload } from '../queue-consumers/comments-tier3';
import type { VideoComment } from '../ports/CommentIngestionPort';
import type { ClassifiedComment } from '../ports/CommentClassificationPort';
import type { CommentsTier3QueueMessage } from '../routes/comments';

type FetchPage = ReturnType<typeof vi.fn>;
const scraperInstances: Array<{ fetchCommentsPage: FetchPage }> = [];
/** Set before each test; the mocked constructor hands out this stub. */
let nextScraperStub: { fetchCommentsPage: FetchPage } | null = null;

vi.mock('../services/MetadataScraper', () => ({
  MetadataScraper: class {
    fetchCommentsPage: FetchPage;
    constructor() {
      this.fetchCommentsPage = (nextScraperStub?.fetchCommentsPage ?? (vi.fn() as unknown as FetchPage)) as FetchPage;
      scraperInstances.push(this);
    }
  },
}));

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

function classifiedFor(comment: VideoComment, overrides: Partial<ClassifiedComment> = {}): ClassifiedComment {
  return {
    comment,
    sentiment: 'positive',
    commentType: 'praise',
    painPoint: 0.1,
    questionAsked: 0.1,
    intensity: 1,
    sentimentConfidence: 0.9,
    lowConfidence: false,
    modelUsed: 'jev',
    ...overrides,
  };
}

beforeEach(() => {
  scraperInstances.length = 0;
  nextScraperStub = null;
  // The consume-side redelivery pre-check (Finding A, 2026-10-05) probes the
  // run status via signed GET before any work; a fresh run is 'pending' and
  // proceeds. POST callbacks (heartbeat/terminal reports) get the plain 200.
  globalFetch.mockReset().mockImplementation((unusedUrl: RequestInfo | URL, init?: RequestInit) => {
    if ((init as { method?: string } | undefined)?.method === 'GET') {
      return Promise.resolve(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', globalFetch);
  classifierMock = vi.fn();
  // default: empty classification (no results, no failures)
  classifierMock.mockResolvedValue({ results: [], costUsd: 0, failedCount: 0 });
});

describe('handleCommentsTier3Message — mode cochran', () => {
  it('requests BOTH orders (relevance + time) and reports pending -> sampling -> completed', async () => {
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    const pool = stubPool(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12']);
    scraperStub.fetchCommentsPage.mockResolvedValue(pool[0]);
    classifierMock.mockResolvedValue({ results: [], costUsd: 0, failedCount: 0 });

    await handleCommentsTier3Message(makeMessage(), ENV);

    const orders = scraperStub.fetchCommentsPage.mock.calls.map((call) => (call[1] as { order?: string }).order);
    expect(orders).toContain('relevance');
    expect(orders).toContain('time');

    const bodies = globalFetch.mock.calls
      .filter(([, init]) => (init as { body?: string }).body !== undefined)
      .map(([, init]) => JSON.parse((init as { body: string }).body));
    const statuses = bodies.map((body) => body.status);
    // #378 P1: mode travels on EVERY callback (heartbeat, success, failure).
    expect(bodies.every((body) => body.mode === 'cochran')).toBe(true);
    // sampling heartbeat first, terminal completed last
    expect(statuses[0]).toBe('sampling');
    expect(statuses[statuses.length - 1]).toBe('completed');
    expect(statuses).not.toContain('pending');
  });

  it('counts failed classifications in insights but stores NO classification row for them', async () => {
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    const pool = stubPool(Array.from({ length: 30 }, (unusedValue, index) => `c${index}`));
    scraperStub.fetchCommentsPage.mockResolvedValue(pool[0]);

    const comments: VideoComment[] = Array.from({ length: 12 }, (unusedValue, index) => ({
      externalId: `c${index}`,
      author: `a${index}`,
      text: `t${index}`,
      likeCount: 1,
      publishedAt: '2026-09-01T00:00:00Z',
    }));
    const results = comments.filter((unusedValue, index) => index < 10).map((videoComment) => classifiedFor(videoComment));
    classifierMock.mockResolvedValue({ results, costUsd: 0.002, failedCount: 2 });

    await handleCommentsTier3Message(makeMessage(), ENV);

    const bodies = globalFetch.mock.calls
      .filter(([, init]) => (init as { body?: string }).body !== undefined)
      .map(([, init]) => JSON.parse((init as { body: string }).body));
    const final = bodies[bodies.length - 1];
    expect(final.status).toBe('completed');
    const cochran: CochranPersistPayload = final.cochran;
    expect(cochran.classifications).toHaveLength(10); // failed 2 NOT stored
    expect(cochran.insights.failed).toBe(2);
    expect(cochran.insights.classified).toBe(10);
    expect(cochran.insights.sampleSize).toBe(28); // Cochran n for pool 30 at e=0.05
    expect(final.sampledCount).toBe(28);
  });

  it('de-duplicates comments shared between the two pools before sampling', async () => {
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    const shared = stubPool(Array.from({ length: 20 }, (unusedValue, index) => `s${index}`))[0].comments;
    scraperStub.fetchCommentsPage.mockImplementation((unusedVideoId: string, params: { order?: string }) => Promise.resolve({
      comments: params.order === 'relevance' ? shared : [...shared].reverse(),
      exhausted: true,
    }));
    let classifyInput: VideoComment[] = [];
    classifierMock.mockImplementation((batch: VideoComment[]) => {
      classifyInput = batch;
      return Promise.resolve({ results: batch.map((videoComment) => classifiedFor(videoComment)), costUsd: 0, failedCount: 0 });
    });

    await handleCommentsTier3Message(makeMessage(), ENV);

    const ids = new Set(classifyInput.map((c) => c.externalId));
    expect(classifyInput.length).toBe(ids.size); // no duplicates reached the classifier
    expect(ids.size).toBe(20); // 40 pool entries -> 20 unique
  });

  it('fails the run loudly (status=failed) when a sampling config value is missing — no silent defaults', async () => {
    const scraperStub = { fetchCommentsPage: vi.fn() as unknown as FetchPage };
    nextScraperStub = scraperStub;
    scraperStub.fetchCommentsPage.mockResolvedValue(stubPool(['c1'])[0]);
    classifierMock.mockClear();

    const message = makeMessage({ sampling: { ...SAMPLING, likeBucketCount: undefined as unknown as number } });
    await handleCommentsTier3Message(message, ENV);

    const bodies = globalFetch.mock.calls
      .filter(([, init]) => (init as { body?: string }).body !== undefined)
      .map(([, init]) => JSON.parse((init as { body: string }).body));
    const statuses = bodies.map((body) => body.status);
    // #378 P1: mode travels on EVERY callback (heartbeat, success, failure).
    expect(bodies.every((body) => body.mode === 'cochran')).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('failed');
    // classifier must never have been invoked with missing config
    expect(classifierMock).not.toHaveBeenCalled();
  });
});

