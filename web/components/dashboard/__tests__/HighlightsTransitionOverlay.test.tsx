/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HighlightsTransitionOverlay } from '../HighlightsTransitionOverlay';

describe('HighlightsTransitionOverlay (Arabic Broadcast Whip-Pan Wipe & SFX)', () => {
  it('renders nothing when active is false', () => {
    const { container } = render(
      <HighlightsTransitionOverlay active={false} direction="forward" volumeGain={1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders whip-pan overlay when active is true', () => {
    render(
      <HighlightsTransitionOverlay active={true} direction="forward" volumeGain={0.8} />
    );

    const overlay = screen.getByTestId('highlights-transition-overlay');
    expect(overlay).toBeDefined();
  });

  it('renders backward whip-pan overlay without throwing', () => {
    render(
      <HighlightsTransitionOverlay active={true} direction="backward" volumeGain={0} />
    );

    const overlay = screen.getByTestId('highlights-transition-overlay');
    expect(overlay).toBeDefined();
  });
});
