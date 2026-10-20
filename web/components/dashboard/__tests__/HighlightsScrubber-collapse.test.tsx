// @vitest-environment happy-dom
// T16: the reel collapses to its header, stays playable, and remembers the choice.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HighlightsScrubber } from '@/components/dashboard/HighlightsScrubber';

const RESPONSE = {
  highlights: [{ idx: 0, start: 10, end: 15, label: 'First moment' }],
  segmentDurationSeconds: 5,
  contextLeadSeconds: 2,
};

describe('HighlightsScrubber – collapse (T16)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => RESPONSE }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the body, keeps Play in the header, and persists', async () => {
    render(<HighlightsScrubber analysisId="a-collapse" videoDurationSeconds={60} />);
    const toggle = await screen.findByTestId('highlights-collapse-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('verbatim-caption')).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('verbatim-caption')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play highlights' })).toBeTruthy();
    expect(window.localStorage.getItem('hex:highlights:v1:collapsed')).toBe('1');
  });

  it('starts collapsed when the viewer collapsed it before', async () => {
    window.localStorage.setItem('hex:highlights:v1:collapsed', '1');
    render(<HighlightsScrubber analysisId="a-collapse-2" videoDurationSeconds={60} />);
    const toggle = await screen.findByTestId('highlights-collapse-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
