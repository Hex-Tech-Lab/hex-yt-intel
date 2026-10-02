/**
 * R3b 2.5e: K>1 run UI. While useJevRunStore.run is set, dimension cards keep
 * the active edge (done cards stay clickable) and the detail panel is locked:
 * Copy disabled, "Applying intelligence…" banner with a live ETA. After the
 * run, partial dimensions show "Based on part of the video".
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DimensionCard } from '@/components/templates/console/StreamingGrid';
import { DimensionDrawer } from '@/components/templates/console/DimensionDrawer';
import { useJevRunStore } from '@/store/useJevRunStore';

const DIMENSION = { label: 'Core Thesis', content: 'Chunk 0 live text for the core thesis.', icon: 'solar:document-linear', number: 3 };
const CARD = { key: 'dim-3', label: 'Core Thesis', icon: 'solar:document-linear', status: 'done' as const, content: 'Chunk 0 live text.' };

function banner() {
  return screen.getAllByRole('status').find((el) => el.textContent?.includes('Applying intelligence…'))!;
}

function copyButton() {
  return screen.getAllByRole('button').find((b) => /copy/i.test(b.getAttribute('aria-label') ?? ''))!;
}

describe('K>1 run UI lock (R3b 2.5e)', () => {
  beforeEach(() => useJevRunStore.getState().clear());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('done cards keep the active edge during a run and stay clickable', () => {
    const onOpen = vi.fn();
    useJevRunStore.getState().startRun(9, Date.now());
    const { container } = render(<DimensionCard dimension={CARD} index={0} onOpen={onOpen} />);
    expect(container.querySelector('[data-active="true"]')).not.toBeNull();
    screen.getByRole('button', { name: /open core thesis/i }).click();
    expect(onOpen).toHaveBeenCalledWith('dim-3');
  });

  it('done cards are not active once the run is over', () => {
    const { container } = render(<DimensionCard dimension={CARD} index={0} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-active="true"]')).toBeNull();
  });

  it('locks Copy and shows the banner with a ticking ETA while running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useJevRunStore.getState().startRun(4, 0);
    render(<DimensionDrawer dimension={DIMENSION} onClose={vi.fn()} />);

    const copy = copyButton();
    expect(copy.hasAttribute('disabled') || copy.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(banner().textContent).toContain('Applying intelligence…');
    expect(banner().textContent).toContain('Estimating…');

    // 1 of 4 cells settled at 10 s; one tick later (11 s): 11 s/cell x 3 left = 33 s.
    act(() => {
      vi.setSystemTime(10_000);
      useJevRunStore.getState().markCellSettled();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(banner().textContent).toContain('ETA: 33s');
  });

  it('unlocks Copy, drops the banner and badges partial dimensions after the run', () => {
    useJevRunStore.getState().startRun(4, 0);
    render(<DimensionDrawer dimension={DIMENSION} onClose={vi.fn()} />);
    act(() => useJevRunStore.getState().finishRun([3]));

    const copy = copyButton();
    expect(copy.hasAttribute('disabled')).toBe(false);
    expect(copy.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByText('Applying intelligence…')).toBeNull();
    expect(screen.getByText('Based on part of the video')).not.toBeNull();
  });

  it('no badge for a dimension the reducer did not flag', () => {
    useJevRunStore.getState().finishRun([5]);
    render(<DimensionDrawer dimension={DIMENSION} onClose={vi.fn()} />);
    expect(screen.queryByText('Based on part of the video')).toBeNull();
  });
});
