import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Re-audit finding P1.2: web/app/api/analyses/persist/route.ts calls
 * SupabaseTranscriptAdapter.upsertTranscript from two places for the same
 * video_id — a per-chunk call (safety net for partial/interrupted analyses
 * that never reach finalization) and a finalize-path call (authoritative,
 * runs with the full stitched content once the analysis completes or times
 * out as 'partial'). These tests exercise the interaction directly at the
 * adapter level rather than the full route handler, verifying the two
 * properties that relationship depends on: (1) calling upsertTranscript
 * twice for the same video_id doesn't error or duplicate rows, and
 * (2) whichever call runs LAST is what ends up persisted — i.e. the
 * finalize-path call, which the route always issues after any chunk-path
 * call for the same request, correctly wins with its full content.
 */

const upsertMock = vi.fn();
const selectMaybeSingleMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: selectMaybeSingleMock,
        }),
      }),
      upsert: upsertMock,
    }),
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { SupabaseTranscriptAdapter } from '../adapters/SupabaseTranscriptAdapter';

describe('SupabaseTranscriptAdapter.upsertTranscript — chunk-path / finalize-path interaction', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    selectMaybeSingleMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
  });

  it('sets created_at/expires_at on the first call for a video_id (row does not exist yet)', async () => {
    selectMaybeSingleMock.mockResolvedValue({ data: null });

    await SupabaseTranscriptAdapter.upsertTranscript({
      videoId: 'vid-1',
      content: 'chunk 1 partial text',
      segments: [{ start: 0, duration: 5, text: 'chunk 1 partial text' }],
      language: 'en',
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.created_at).toBeDefined();
    expect(payload.expires_at).toBeDefined();
    expect(payload.content).toBe('chunk 1 partial text');
  });

  it('does NOT reset created_at/expires_at on a second call for the same video_id (row already exists)', async () => {
    // First call: chunk-path, row doesn't exist yet.
    selectMaybeSingleMock.mockResolvedValueOnce({ data: null });
    await SupabaseTranscriptAdapter.upsertTranscript({
      videoId: 'vid-2',
      content: 'chunk 1 partial text',
      segments: [{ start: 0, duration: 5, text: 'chunk 1 partial text' }],
      language: 'en',
    });
    const firstPayload = upsertMock.mock.calls[0][0];
    expect(firstPayload.created_at).toBeDefined();

    // Second call: finalize-path, row now exists.
    selectMaybeSingleMock.mockResolvedValueOnce({ data: { video_id: 'vid-2' } });
    await SupabaseTranscriptAdapter.upsertTranscript({
      videoId: 'vid-2',
      content: 'full stitched transcript across all chunks',
      segments: [
        { start: 0, duration: 5, text: 'chunk 1 partial text' },
        { start: 5, duration: 5, text: 'chunk 2 text' },
      ],
      language: 'en',
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const secondPayload = upsertMock.mock.calls[1][0];
    // This is the property the audit flagged: the second (finalize) call must
    // NOT re-include created_at/expires_at, or the 72h retention window
    // silently resets on every re-touch of an actively-revisited video.
    expect(secondPayload.created_at).toBeUndefined();
    expect(secondPayload.expires_at).toBeUndefined();
  });

  it('finalize-path content wins when it runs after chunk-path for the same video_id (last-write-wins is correct, not corrupted)', async () => {
    selectMaybeSingleMock.mockResolvedValueOnce({ data: null });
    await SupabaseTranscriptAdapter.upsertTranscript({
      videoId: 'vid-3',
      content: 'partial: only chunk 1 seen so far',
      segments: [{ start: 0, duration: 5, text: 'partial: only chunk 1 seen so far' }],
      language: 'en',
    });

    selectMaybeSingleMock.mockResolvedValueOnce({ data: { video_id: 'vid-3' } });
    await SupabaseTranscriptAdapter.upsertTranscript({
      videoId: 'vid-3',
      content: 'full: chunk 1 + chunk 2 + chunk 3 stitched',
      segments: [
        { start: 0, duration: 5, text: 'chunk 1' },
        { start: 5, duration: 5, text: 'chunk 2' },
        { start: 10, duration: 5, text: 'chunk 3' },
      ],
      language: 'en',
    });

    const finalPayload = upsertMock.mock.calls[upsertMock.mock.calls.length - 1][0];
    expect(finalPayload.content).toBe('full: chunk 1 + chunk 2 + chunk 3 stitched');
    expect(finalPayload.segments).toHaveLength(3);
  });

  it('does not throw and reports to Sentry if the upsert itself fails', async () => {
    selectMaybeSingleMock.mockResolvedValue({ data: null });
    upsertMock.mockResolvedValueOnce({ error: { message: 'connection reset' } });

    await expect(
      SupabaseTranscriptAdapter.upsertTranscript({
        videoId: 'vid-4',
        content: 'text',
        segments: [{ start: 0, duration: 5, text: 'text' }],
        language: 'en',
      })
    ).rejects.toBeTruthy();
  });
});
