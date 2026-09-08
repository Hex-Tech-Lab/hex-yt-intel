// @vitest-environment happy-dom
//
// Regression test for PR #264: "Play highlights" was a permanent no-op
// because currentPlaybackSeconds starts null and the readiness gate
// treated null as "not ready" instead of "t=0" for this store-backed
// caller. See HighlightsScrubber.tsx's own comment for the full mechanism.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HighlightsScrubber } from '@/components/dashboard/HighlightsScrubber';
import { useVideoStore } from '@/store/useVideoStore';

const HIGHLIGHTS_RESPONSE = {
  highlights: [
    { idx: 0, start: 10, end: 15, label: 'First moment' },
    { idx: 1, start: 30, end: 35, label: 'Second moment' },
  ],
  segmentDurationSeconds: 5,
  contextLeadSeconds: 2,
};

describe('HighlightsScrubber', () => {
  beforeEach(() => {
    useVideoStore.setState({ seekTo: null, isPlaying: false, currentPlaybackSeconds: null });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => HIGHLIGHTS_RESPONSE,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useVideoStore.setState({ seekTo: null, isPlaying: false, currentPlaybackSeconds: null });
  });

  it('clicking "Play highlights" actually seeks and starts playback even before any video time is known', async () => {
    render(<HighlightsScrubber analysisId="analysis-1" videoDurationSeconds={60} />);

    const playButton = await screen.findByRole('button', { name: 'Play highlights' });

    // The exact live-bug precondition: nothing has played yet.
    expect(useVideoStore.getState().currentPlaybackSeconds).toBeNull();

    fireEvent.click(playButton);

    // Before the fix, start() queued silently and never flushed -- seekTo
    // stayed null forever since nothing else ever calls it.
    await waitFor(() => {
      expect(useVideoStore.getState().seekTo).toBe(8); // 10 - 2 lead-in
    });
    expect(useVideoStore.getState().isPlaying).toBe(true);
  });

  it('collapses gracefully without crashing when highlights array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({ highlights: [], segmentDurationSeconds: 5, contextLeadSeconds: 2 }),
      })
    );

    const { container } = render(<HighlightsScrubber analysisId="analysis-empty" videoDurationSeconds={60} />);

    await waitFor(() => {
      // Empty state banner is now rendered instead of collapsing to null
      expect(container.firstChild).not.toBeNull();
      expect(container.firstChild?.textContent).toContain('No highlights yet');
    }, { timeout: 40000 });
  }, 45000);

  it('bounded polling retries on empty before showing empty state banner', async () => {
    // 5 attempts, capped-exponential backoff (2.5s/5s/10s/15s -- see
    // highlights-settings.ts's HIGHLIGHTS_STATUS_RETRY_* constants and their
    // doc comment for why this window widened from the original 3/2.5s/5s).
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ highlights: [], segmentDurationSeconds: 5, contextLeadSeconds: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<HighlightsScrubber analysisId="analysis-poll" videoDurationSeconds={60} />);

    await vi.advanceTimersByTimeAsync(2600);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5100);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10100);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(15100);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await vi.advanceTimersByTimeAsync(100);
    // Empty state banner is now rendered instead of collapsing to null
    expect(container.firstChild).not.toBeNull();
    expect(container.firstChild?.textContent).toContain('No highlights yet');
  });

  it('re-triggers the highlights fetch when digestLoading transitions to false, even after the initial retry budget was FULLY exhausted', async () => {
    // The real bug this covers (live production repro, 2026-09-08): a fresh
    // analysis's highlights are backfilled by scheduleHighlightsRecovery()
    // AFTER digest generation, which can land well after this component's
    // own retry budget gives up. digestLoading:true->false is the real
    // signal that recovery has now been scheduled server-side -- verify it
    // actually restarts the fetch cycle AFTER the full 5-attempt schedule
    // has already run out (CodeRabbit review, PR #298: the original version
    // of this test only exercised 1 fetch call before switching
    // digestLoading, never proving recovery works post-exhaustion).
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ highlights: [], segmentDurationSeconds: 5, contextLeadSeconds: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { container, rerender } = render(
      <HighlightsScrubber analysisId="analysis-digest-race" videoDurationSeconds={60} digestLoading={true} />
    );

    // Run through the complete 5-attempt retry schedule (2.5s/5s/10s/15s).
    await vi.advanceTimersByTimeAsync(2600);
    await vi.advanceTimersByTimeAsync(5100);
    await vi.advanceTimersByTimeAsync(10100);
    await vi.advanceTimersByTimeAsync(15100);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(container.firstChild?.textContent).toContain('No highlights yet');

    // Now the recovery response is available -- simulate digest finishing.
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          highlights: [{ idx: 0, start: 10, end: 15, label: 'Recovered highlight' }],
          segmentDurationSeconds: 5,
          contextLeadSeconds: 2,
        }),
    });
    rerender(<HighlightsScrubber analysisId="analysis-digest-race" videoDurationSeconds={60} digestLoading={false} />);
    // First attempt of the new fetch cycle resolves with real highlights --
    // no retry delay needed, but a microtask flush is required under fake timers.
    await vi.advanceTimersByTimeAsync(0);

    expect(container.firstChild?.textContent).not.toContain('No highlights yet');
    expect(container.firstChild?.textContent).toContain('keypoints ready to play');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('fetches fresh highlights for a NEW analysisId even while the previous analysisId still has cached highlights (CodeRabbit, PR #298)', async () => {
    // Real bug: the "already have highlights, don't refetch on a digestLoading
    // flip" guard checked `data` alone, so switching analysisId while old
    // `data` still had highlights.length > 0 skipped the fetch entirely,
    // leaving the PREVIOUS analysis's highlights rendered under the new one.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ highlights: [{ idx: 0, start: 1, end: 5, label: 'Analysis 1 highlight' }], segmentDurationSeconds: 5, contextLeadSeconds: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ highlights: [{ idx: 0, start: 2, end: 6, label: 'Analysis 2 highlight' }], segmentDurationSeconds: 5, contextLeadSeconds: 2 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { container, rerender } = render(
      <HighlightsScrubber analysisId="analysis-1" videoDurationSeconds={60} />
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.firstChild?.textContent).toContain('keypoints ready to play'));

    rerender(<HighlightsScrubber analysisId="analysis-2" videoDurationSeconds={60} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toContain('analysisId=analysis-2');
  });

  it('collapses gracefully on fetch error without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      })
    );

    const { container } = render(<HighlightsScrubber analysisId="analysis-err" videoDurationSeconds={60} />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('hard HTTP error fails closed immediately without polling', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Forbidden' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<HighlightsScrubber analysisId="analysis-403" videoDurationSeconds={60} />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
