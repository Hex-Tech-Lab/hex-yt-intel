// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighlightsTrack, type HighlightsTrackHighlight } from './HighlightsTrack';

/**
 * Real component-render coverage (ADR 024 pattern -- happy-dom + RTL) for
 * the shared marker-track shell used by both HighlightsScrubber.tsx and
 * PublicHighlightsReel.tsx. A pure unit test can't catch a render crash or
 * a broken click handler; this renders the actual DOM.
 */
function makeHighlights(n: number): HighlightsTrackHighlight[] {
  return Array.from({ length: n }, (_, i) => ({ idx: i, start: i * 30, end: i * 30 + 10, label: `Highlight ${i}` }));
}

describe('HighlightsTrack', () => {
  it('renders nothing for an empty highlight list', () => {
    const { container } = render(
      <HighlightsTrack highlights={[]} activeIndex={null} onSelect={() => {}} videoDurationSeconds={600} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a marker per highlight and the "#N of M" counter for the active one', () => {
    const highlights = makeHighlights(5);
    render(<HighlightsTrack highlights={highlights} activeIndex={2} onSelect={() => {}} videoDurationSeconds={600} />);
    expect(screen.getByText('#3 of 5')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Jump to highlight/i })).toHaveLength(5);
  });

  it('Next/Prev call onSelect with the adjacent index and respect the ends', () => {
    const highlights = makeHighlights(3);
    const onSelect = vi.fn();
    render(<HighlightsTrack highlights={highlights} activeIndex={0} onSelect={onSelect} videoDurationSeconds={90} />);

    const prevButton = screen.getByRole('button', { name: 'Previous highlight' });
    const nextButton = screen.getByRole('button', { name: 'Next highlight' });

    expect(prevButton).toBeDisabled(); // already at index 0
    fireEvent.click(nextButton);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('clicking a marker jumps directly to that highlight index', () => {
    const highlights = makeHighlights(4);
    const onSelect = vi.fn();
    render(<HighlightsTrack highlights={highlights} activeIndex={0} onSelect={onSelect} videoDurationSeconds={120} />);

    fireEvent.click(screen.getByRole('button', { name: /Jump to highlight 3/i }));
    expect(onSelect).toHaveBeenCalledWith(2); // idx is 0-based, label is 1-based
  });
});
