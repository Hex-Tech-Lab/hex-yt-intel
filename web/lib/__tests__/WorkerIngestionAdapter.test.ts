/**
 * WorkerIngestionAdapter — telemetry regression test.
 *
 * Verifies the fix for a real bug: a transcript-fetch network failure used to
 * vanish silently (via Promise.allSettled) and get reported to the user as
 * "no transcript available" -- indistinguishable from the video genuinely
 * having no captions. And a metadata-fetch failure replaced the real error
 * with a generic message, discarding the actual cause.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

let fetchMock: ReturnType<typeof vi.fn>;

describe('WorkerIngestionAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('propagates the real metadata-fetch error instead of a generic message', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    await expect(adapter.fetch('abc123')).rejects.toThrow(/Failed to fetch metadata from Worker: Failed to fetch/);
  });

  it('falls back to metadata-only (empty transcript) when transcript fetch fails, without throwing', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    const result = await adapter.fetch('abc123');

    expect(result.metadata.title).toBe('Test Video');
    expect(result.transcript).toBe('');
    expect(result.transcriptAvailable).toBe(false);
  });

  it('reports transcript-fetch failures to Sentry (previously silent)', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    await adapter.fetch('abc123');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ phase: 'fetch-transcript' }) })
    );
  });

  it('returns metadata and transcript together on success', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ transcript: 'hello world', segments: [] }),
      }));

    const adapter = new WorkerIngestionAdapter();
    const result = await adapter.fetch('abc123');

    expect(result.metadata.title).toBe('Test Video');
    expect(result.transcript).toBe('hello world');
    expect(result.transcriptAvailable).toBe(true);
  });
});
