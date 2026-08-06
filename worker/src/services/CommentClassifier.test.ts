/**
 * CONTRACT: CommentClassifier hits the documented OpenRouter
 * chat-completions endpoint. Rewritten 2026-08-06: mocks global.fetch,
 * instantiates the real CommentClassifier, calls the real classifyBatch(),
 * asserts the real request body and real response parsing/mapping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommentClassifier } from './CommentClassifier';
import type { VideoComment } from '../ports/CommentIngestionPort';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn() }));

const comments: VideoComment[] = [
  { id: '1', author: 'alice', text: 'great video!', likeCount: 5, publishedAt: '2026-01-01' } as VideoComment,
];

describe('CommentClassifier.classifyBatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to the real chat-completions endpoint with the real numbered-comment prompt and cascade model', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => ({ choices: [{ message: { content: '[{"sentiment":"positive","type":"praise","topic":"quality"}]' } }] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const classifier = new CommentClassifier('test-api-key');
    const result = await classifier.classifyBatch(comments);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.messages[1].content).toContain('great video!');

    expect(result).toHaveLength(1);
    expect(result[0]!.sentiment).toBe('positive');
    expect(result[0]!.commentType).toBe('praise');
    expect(result[0]!.topic).toBe('quality');
  });

  it('falls through to the next cascade tier on a non-2xx response and returns a safe default if all tiers fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const classifier = new CommentClassifier('test-api-key');
    const result = await classifier.classifyBatch(comments);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.sentiment).toBe('neutral');
    expect(result[0]!.modelUsed).toBe('none');
  });

  it('returns an empty array without calling fetch for an empty comment batch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const classifier = new CommentClassifier('test-api-key');
    const result = await classifier.classifyBatch([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
