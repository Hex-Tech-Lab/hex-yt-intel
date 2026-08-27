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
      expect(container.firstChild).toBeNull();
    }, { timeout: 10000 });
  }, 15000);

  it('bounded polling retries on empty before collapsing', async () => {
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

    await vi.advanceTimersByTimeAsync(100);
    expect(container.firstChild).toBeNull();
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
