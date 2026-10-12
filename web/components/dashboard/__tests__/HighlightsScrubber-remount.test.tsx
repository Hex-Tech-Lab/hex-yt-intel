// @vitest-environment happy-dom
// T5 (a): Simple and Pro each mount their own HighlightsScrubber, so a mode
// switch remounts it. The reel's playing segment must survive that remount.
// T5 (b): reel interactions must never scroll the page.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HighlightsScrubber } from '@/components/dashboard/HighlightsScrubber';
import { useVideoStore } from '@/store/useVideoStore';

const RESPONSE = {
  highlights: [
    { idx: 0, start: 10, end: 15, label: 'First moment' },
    { idx: 1, start: 30, end: 35, label: 'Second moment' },
  ],
  segmentDurationSeconds: 5,
  contextLeadSeconds: 2,
};

describe('HighlightsScrubber – remount keeps playback position (T5 a)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useVideoStore.getState().reset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => RESPONSE }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the playing highlight index after a Simple-to-Pro style remount', async () => {
    const first = render(<HighlightsScrubber analysisId="a-remount" videoDurationSeconds={60} />);
    await screen.findByTestId('highlights-collapse-toggle');
    fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
    expect(await screen.findByText('#1 of 2')).toBeTruthy();

    // Mode switch: the old container unmounts, the new one mounts the same analysis.
    first.unmount();
    render(<HighlightsScrubber analysisId="a-remount" videoDurationSeconds={60} />);

    await waitFor(() => expect(screen.getByText('#1 of 2')).toBeTruthy());
    expect(screen.queryByText('2 moments')).toBeNull();
  });
});

describe('HighlightsScrubber – reel never scrolls the page (T5 b)', () => {
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    useVideoStore.getState().reset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => RESPONSE }));
    scrollIntoViewSpy = vi.fn();
    scrollToSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as Element['scrollIntoView'];
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('play, seek, prev/next and speed make zero scroll calls', async () => {
    render(<HighlightsScrubber analysisId="a-noscroll" videoDurationSeconds={60} />);
    await screen.findByTestId('highlights-collapse-toggle');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play highlights' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Jump to highlight 2: Second moment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous highlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
    fireEvent.click(screen.getByRole('button', { name: /Playback speed/ }));

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
