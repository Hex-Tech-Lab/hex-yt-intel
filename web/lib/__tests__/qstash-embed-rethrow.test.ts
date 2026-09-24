/**
 * publishEmbeddingTask must REJECT on publish failure (after the Sentry
 * capture), not resolve with the legacy 'unknown' sentinel — otherwise
 * every caller's .catch() (persist side-effect-failed flag, reaper/
 * remediation log-and-continue) can never fire and a failed publish is
 * silently treated as success. RCA: PR #327 round 2 external review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const publishJSON = vi.hoisted(() => vi.fn());

vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(function mockClientClass() {
    return { publishJSON };
  }),
  Receiver: vi.fn(),
}));

import { publishEmbeddingTask } from '@/lib/qstash-client';

describe('publishEmbeddingTask rejects on publish failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QSTASH_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  });

  it('rejects (does not resolve "unknown") and captures to Sentry when the publish fails', async () => {
    publishJSON.mockRejectedValue(new Error('qstash publish failed'));

    await expect(publishEmbeddingTask({ analysisId: 'a1', markdown: 'md', userId: 'u1' })).rejects.toThrow('qstash publish failed');

    const { captureException } = await import('@sentry/nextjs');
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still resolves with the messageId on success', async () => {
    publishJSON.mockResolvedValue({ messageId: 'msg-1' });

    await expect(publishEmbeddingTask({ analysisId: 'a1', markdown: 'md', userId: 'u1' })).resolves.toBe('msg-1');
  });
});
