/** @vitest-environment jsdom */
// T13 (playback stutter): render-isolation and motion guards for the highlights
// reel that sits beside the YouTube iframe. Each test has a negative control --
// the same assertion flips when the fix it protects is reverted.
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('HighlightsTransitionOverlay reduced motion (T13)', () => {
  const originalMatchMedia = window.matchMedia;

  function stubReducedMotion(matches: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders no whip-pan wipe over the player when the user prefers reduced motion', () => {
    stubReducedMotion(true);
    render(<HighlightsTransitionOverlay active={true} direction="forward" volumeGain={0} />);
    expect(screen.queryByTestId('highlights-transition-overlay')).toBeNull();
  });

  it('still renders the whip-pan wipe for users without a reduced-motion preference (negative control)', () => {
    stubReducedMotion(false);
    render(<HighlightsTransitionOverlay active={true} direction="forward" volumeGain={0} />);
    expect(screen.getByTestId('highlights-transition-overlay')).toBeTruthy();
  });
});
