/**
 * WorkerIngestionAdapter — telemetry regression test.
 *
 * Verifies the fix for a real bug: a transcript-fetch network failure used to
 * vanish silently (via Promise.allSettled) and get reported to the user as
 * "no transcript available" -- indistinguishable from the video genuinely
 * having no captions. And a metadata-fetch failure replaced the real error
 * with a generic message, discarding the actual cause.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerIngestionAdapter } from '../adapters/WorkerIngestionAdapter';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

const upsertTranscript = vi.fn();
vi.mock('@/lib/adapters/SupabaseTranscriptAdapter', () => ({ SupabaseTranscriptAdapter: { upsertTranscript } }));

const realFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

// Every ingestion call goes through here so the fetch mock is swapped out in
// finally, even when the call rejects. afterEach is the backstop for tests that
// fail before reaching a call.
async function ingest(adapter: WorkerIngestionAdapter, videoId: string) {
  try {
    return await adapter.fetch(videoId);
  } finally {
    global.fetch = realFetch;
  }
}

describe('WorkerIngestionAdapter', () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    vi.resetModules();
    upsertTranscript.mockReset();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('propagates the real metadata-fetch error instead of a generic message', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    await expect(ingest(adapter, 'abc123')).rejects.toThrow(/Failed to fetch metadata from Worker: Failed to fetch/);
  });

  it('falls back to metadata-only (empty transcript) when transcript fetch fails, without throwing', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    const result = await ingest(adapter, 'abc123');

    expect(result.metadata.title).toBe('Test Video');
    expect(result.transcript).toBe('');
    expect(result.transcriptAvailable).toBe(false);
  });

  it('reports transcript-fetch failures to Sentry (previously silent)', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const adapter = new WorkerIngestionAdapter();
    await ingest(adapter, 'abc123');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ phase: 'fetch-transcript' }) })
    );
  });

  it('returns metadata and transcript together on success', async () => {
    const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
    fetchMock
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Video', channelTitle: 'Test Channel' }),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ transcript: 'hello world', segments: [] }),
      }));

    const adapter = new WorkerIngestionAdapter();
    const result = await ingest(adapter, 'abc123');

    expect(result.metadata.title).toBe('Test Video');
    expect(result.transcript).toBe('hello world');
    expect(result.transcriptAvailable).toBe(true);
  });

  // Highlights RCA (2026-10-08): server-fetched segments are the only trusted
  // ones; the worker refuses browser-relayed segments (#417), so ingestion must
  // store them or highlight extraction has nothing to work from.
  describe('trusted segment storage', () => {
    const SEGMENTS = [{ text: 'hello', start: 0, duration: 2 }, { text: 'world', start: 2, duration: 2 }];
    function mockFetches(transcriptBody: Record<string, unknown>) {
      fetchMock
        .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 'T', channelTitle: 'C' }) }))
        .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(transcriptBody) }));
    }

    it('stores the transcript with its timed segments and language before returning', async () => {
      const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
      let releaseUpsert!: () => void;
      upsertTranscript.mockReturnValueOnce(new Promise<void>((resolve) => { releaseUpsert = resolve; }));
      mockFetches({ transcript: 'hello world', segments: SEGMENTS, language: 'de' });
      let settled = false;
      const pending = ingest(new WorkerIngestionAdapter(), 'vid1').then((r) => { settled = true; return r; });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(upsertTranscript).toHaveBeenCalledWith({ videoId: 'vid1', content: 'hello world', segments: SEGMENTS, language: 'de' });
      expect(settled).toBe(false);
      releaseUpsert();
      const result = await pending;
      expect(result.segments).toEqual(SEGMENTS);
    });

    it('stores nothing when the worker returned no segments', async () => {
      const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
      mockFetches({ transcript: 'hello world' });
      await ingest(new WorkerIngestionAdapter(), 'vid1');
      expect(upsertTranscript).not.toHaveBeenCalled();
    });

    it('a storage failure is reported but never fails ingestion', async () => {
      const Sentry = await import('@sentry/nextjs');
      const { WorkerIngestionAdapter } = await import('../adapters/WorkerIngestionAdapter');
      upsertTranscript.mockRejectedValueOnce(new Error('db down'));
      mockFetches({ transcript: 'hello world', segments: SEGMENTS });
      const result = await ingest(new WorkerIngestionAdapter(), 'vid1');
      expect(result.transcriptAvailable).toBe(true);
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ phase: 'store-segments' }) }));
    });
  });
});
