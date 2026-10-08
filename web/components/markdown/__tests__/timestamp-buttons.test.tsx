// @vitest-environment happy-dom
//
// Phase-c T3: raw timestamps in dimension markdown (`see 1:23 and 1:02:03`)
// must render as interactive <button> elements (not <a> links) routed
// through the shared MarkdownLink -> TimestampLink(asButton) path, and
// clicking must seek the global video store with the correct seconds.
// Negative control: reverting MarkdownLink's asButton flag fails the
// button-role assertions in this file.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectedDimensionReadout } from '@/components/dashboard/SelectedDimensionReadout';
import { MarkdownLink } from '@/components/markdown/dimensionMarkdownComponents';
import { useVideoStore } from '@/store/useVideoStore';

const MARKDOWN_WITH_TIMESTAMPS = 'Watch the key moment: see 1:23 and 1:02:03 for the full explanation.\n';

describe('clickable timestamp buttons in dimension markdown', () => {
  beforeEach(() => {
    useVideoStore.setState({ isPlaying: false, seekTo: null });
  });

  it('renders raw timestamps as buttons and seeks on click (1:23 -> 83s)', () => {
    render(
      <SelectedDimensionReadout
        dimension={{ label: 'Test', icon: 'solar:case-linear', content: MARKDOWN_WITH_TIMESTAMPS }}
      />
    );
    const btn = screen.getByRole('button', { name: /seek to 1:23/i });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    fireEvent.click(btn);
    expect(useVideoStore.getState().seekTo).toBe(83);
  });

  it('seeks the hour-form timestamp too (1:02:03 -> 3723s)', () => {
    render(
      <SelectedDimensionReadout
        dimension={{ label: 'Test', icon: 'solar:case-linear', content: MARKDOWN_WITH_TIMESTAMPS }}
      />
    );
    const btn = screen.getByRole('button', { name: /seek to 1:02:03/i });
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(useVideoStore.getState().seekTo).toBe(3723);
  });

  it('applies the shared global CSS class (no inline style objects)', () => {
    render(
      <SelectedDimensionReadout
        dimension={{ label: 'Test', icon: 'solar:case-linear', content: MARKDOWN_WITH_TIMESTAMPS }}
      />
    );
    const btn = screen.getByRole('button', { name: /seek to 1:23/i });
    expect(btn.className).toContain('hx-timestamp-seek');
    expect(btn).not.toHaveAttribute('style');
  });

  it('renders MarkdownLink #t= hrefs as a seek button directly', () => {
    render(<MarkdownLink href="#t=30">⏱ 0:30</MarkdownLink>);
    const btn = screen.getByRole('button', { name: /seek to/i });
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(useVideoStore.getState().seekTo).toBe(30);
  });

  it('keeps non-timestamp links as anchors', () => {
    render(
      <SelectedDimensionReadout
        dimension={{
          label: 'Test',
          icon: 'solar:case-linear',
          content: 'See [external site](https://example.com/docs) for details.\n',
        }}
      />
    );
    const link = screen.getByRole('link', { name: 'external site' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('uses the href seconds as the seek target even when the text disagrees ([1:23](#t=30) -> 30s)', () => {
    render(
      <SelectedDimensionReadout
        dimension={{
          label: 'Test',
          icon: 'solar:case-linear',
          content: 'Jump to [1:23](#t=30) here.\n',
        }}
      />
    );
    const btn = screen.getByRole('button', { name: /seek to/i });
    expect(btn.textContent).toContain('1:23');
    expect(btn).toHaveAttribute('data-timestamp', '0:30');
    fireEvent.click(btn);
    expect(useVideoStore.getState().seekTo).toBe(30);
  });
});
