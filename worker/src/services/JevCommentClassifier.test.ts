import { describe, it, expect, vi, afterEach } from 'vitest';

import { JevCommentClassifier } from './JevCommentClassifier';
import type { VideoComment } from '../ports/CommentIngestionPort';

// Endpoint contract: the Jev Decisions API is called with POST, the X-Title
// attribution header, and a body carrying the model and the question state.
// (Decisions API body uses `state`/`questions`, not chat `messages`.)
describe('JevCommentClassifier endpoint contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Decisions endpoint with X-Title and model in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const classifier = new JevCommentClassifier('test-key');
    const comment = { commentId: 'c1', text: 'Great video' } as unknown as VideoComment;
    await classifier.classifyBatch([comment]).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Title']).toBe('vIntel - Jev Comment Classifier');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('~typesafe/jev-latest');
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('questions');
  });
});
