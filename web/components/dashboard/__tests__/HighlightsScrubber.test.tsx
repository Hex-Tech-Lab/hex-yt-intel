// @vitest-environment happy-dom
//
// Regression test for a live-reported bug (2026-08-20, screenshot: "click
// Play highlights, nothing happens"): PR #263's readiness gate on
// useSegmentPlayback's start()/jumpTo() made HighlightsScrubber's "Play
// highlights" button a permanent no-op. Root cause: currentPlaybackSeconds
// starts null (nothing has played yet) and VideoPlayerCard only ever writes
// to it while isPlaying is true -- but isPlaying only becomes true via the
// very setSeekTo call the readiness gate was withholding while
// getCurrentTime() returned null. A hard deadlock: nothing left to ever
// flush the queued start. Fixed by treating null as t=0 (not "not ready")
// in this caller's primitives, since VideoPlayerCard is already mounted by
// the time this component renders (DashboardContainer's own render guard).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
