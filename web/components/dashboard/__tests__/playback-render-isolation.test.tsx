/** @vitest-environment happy-dom */
// T13 (playback stutter): render-isolation and motion guards for the highlights
// reel that sits beside the YouTube iframe. Each test has a negative control --
// the render-count and blur assertions flip when the fix they protect is reverted
// (the "counter is live" test is the control for the render-count one).
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const counters = vi.hoisted(() => ({ tooltipRenders: 0 }));

vi.mock('@astryxdesign/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@astryxdesign/core')>();
  return {
    ...actual,
    // Counts how many marker Tooltips are (re)built. Each highlight marker is
    // wrapped in one Tooltip, so this counter moves exactly when the track
    // re-renders its marker list.
    Tooltip: ({ children }: { children: React.ReactNode }) => {
      counters.tooltipRenders += 1;
      return <>{children}</>;
    },
  };
});

import { useVideoStore } from '@/store/useVideoStore';
import { HighlightsTrack, type HighlightsTrackHighlight } from '../HighlightsTrack';
import { HighlightsTransitionOverlay } from '../HighlightsTransitionOverlay';

const HIGHLIGHTS: HighlightsTrackHighlight[] = [
  { idx: 0, start: 10, end: 25, label: 'first' },
  { idx: 1, start: 60, end: 80, label: 'second' },
  { idx: 2, start: 120, end: 140, label: 'third' },
];

describe('HighlightsTrack render isolation (T13)', () => {
  beforeEach(() => {
    counters.tooltipRenders = 0;
  });

  it('does not rebuild the marker track when the parent re-renders with identical props', () => {
    const onSelect = () => {};
    const { rerender } = render(
      <HighlightsTrack
        highlights={HIGHLIGHTS}
        activeIndex={0}
        onSelect={onSelect}
        videoDurationSeconds={300}
        segmentDurationSeconds={10}
      />
    );
    const afterMount = counters.tooltipRenders;
    expect(afterMount).toBeGreaterThan(0);

    // Simulates HighlightsScrubber's ~4 Hz elapsed-tick re-render: same
    // reference-stable props, new element identity.
    for (let tick = 0; tick < 5; tick += 1) {
      rerender(
        <HighlightsTrack
          highlights={HIGHLIGHTS}
          activeIndex={0}
          onSelect={onSelect}
          videoDurationSeconds={300}
          segmentDurationSeconds={10}
        />
      );
    }
    expect(counters.tooltipRenders).toBe(afterMount);
  });

  it('still rebuilds the marker track when a rendered prop actually changes (counter is live)', () => {
    const onSelect = () => {};
    const { rerender } = render(
      <HighlightsTrack highlights={HIGHLIGHTS} activeIndex={0} onSelect={onSelect} videoDurationSeconds={300} segmentDurationSeconds={10} />
    );
    const afterMount = counters.tooltipRenders;
    rerender(
      <HighlightsTrack highlights={HIGHLIGHTS} activeIndex={1} onSelect={onSelect} videoDurationSeconds={300} segmentDurationSeconds={10} />
    );
    expect(counters.tooltipRenders).toBeGreaterThan(afterMount);
  });
});

describe('HighlightsTrack playhead under memo (T13)', () => {
  it('keeps the needle moving from the store while props are unchanged', async () => {
    const onSelect = () => {};
    render(
      <HighlightsTrack highlights={HIGHLIGHTS} activeIndex={0} onSelect={onSelect} videoDurationSeconds={300} segmentDurationSeconds={10} />
    );
    act(() => {
      useVideoStore.setState({ currentPlaybackSeconds: 150 });
    });
    await waitFor(() => expect(screen.getByTestId('playhead-needle').style.left).toBe('50%'), { timeout: 2000 });
  });
});

describe('HighlightsTransitionOverlay (T13)', () => {
  it('still renders the whip-pan wipe layer when active, without backdrop-blur', () => {
    const { container } = render(<HighlightsTransitionOverlay active={true} direction="forward" volumeGain={0} />);
    expect(screen.getByTestId('highlights-transition-overlay')).toBeTruthy();
    expect(container.innerHTML).not.toContain('backdrop-blur');
  });
});
