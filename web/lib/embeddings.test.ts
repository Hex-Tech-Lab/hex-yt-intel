/**
 * CONTRACT: embeddings.ts hits OpenRouter /embeddings with a valid,
 * provider-qualified model slug.
 *
 * Rewritten 2026-08-06: the previous version asserted a local literal
 * against itself, never calling generateEmbedding. This mocks global.fetch
 * and calls the REAL exported generateEmbedding, asserting the real
 * request body actually contains "openai/text-embedding-3-small" -- proven
 * with a negative control (reverting the model id to the bare
 * "text-embedding-3-small" makes this test fail).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateEmbedding, cosineSimilarity } from './embeddings';

const originalEnv = { ...process.env };

describe('generateEmbedding', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('sends the provider-qualified model id "openai/text-embedding-3-small" in the real request body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => ({ data: [{ object: 'embedding', index: 0, embedding: new Array(1536).fill(0.01) }] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await generateEmbedding('some text to embed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('openai/text-embedding-3-small');
  });

  it('returns the parsed embedding vector and a nonzero estimated cost', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => ({ data: [{ object: 'embedding', index: 0, embedding: new Array(1536).fill(0.5) }] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateEmbedding('some text to embed');

    expect(result.embedding).toHaveLength(1536);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('retries on failure and eventually throws after RETRY_MAX_ATTEMPTS with a descriptive error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => 'server error' } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateEmbedding('text')).rejects.toThrow(/Failed to generate embedding after 3 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it('throws immediately for empty text without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateEmbedding('   ')).rejects.toThrow('Cannot generate embedding for empty text');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cosineSimilarity (pure function, unaffected by the endpoint fix, kept for regression coverage)', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
