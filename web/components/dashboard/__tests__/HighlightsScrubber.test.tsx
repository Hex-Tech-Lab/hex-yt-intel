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
});
