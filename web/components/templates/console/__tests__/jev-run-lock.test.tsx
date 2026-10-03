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
  const found = screen.getAllByRole('status').find((el) => el.textContent?.includes('Applying intelligence…'));
  if (!found) throw new Error('banner not rendered');
  return found;
}

function copyButton() {
  const found = screen.getAllByRole('button').find((b) => /copy/i.test(b.getAttribute('aria-label') ?? ''));
  if (!found) throw new Error('copy button not rendered');
  return found;
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

    // 1 of 4 cells settled at 10 s (seeds 30 s); one 1 s tick of countdown (11 s): ETA: 29s.
    act(() => {
      vi.setSystemTime(10_000);
      useJevRunStore.getState().markCellSettled();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(banner().textContent).toContain('ETA: 29s');
  });

  it('ETA decreases on ticks with no settlement and blends toward new estimate on settlement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useJevRunStore.getState().startRun(4, 0);
    render(<DimensionDrawer dimension={DIMENSION} onClose={vi.fn()} />);

    act(() => {
      vi.setSystemTime(10_000);
      useJevRunStore.getState().markCellSettled();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(banner().textContent).toContain('ETA: 29s');

    let prevEta = 29;
    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const match = banner().textContent?.match(/ETA:\s*(\d+)s/);
      expect(match).not.toBeNull();
      const currentEta = parseInt(match![1]!, 10);
      expect(currentEta).toBe(prevEta - 1);
      prevEta = currentEta;
    }
    // After 5 ticks (at t=16s), remainingMs is 24,000 (ETA: 24s)
    expect(banner().textContent).toContain('ETA: 24s');

    // Settle 2nd cell at t=16s:
    // settled = 2 of 4, elapsed = 16,000ms.
    // raw = (16,000 / 2) * (4 - 2) = 16,000ms.
    // countdown = 24,000ms.
    // gap = 24,000 - 16,000 = 8,000ms.
    // blend: round(0.2 * 16,000 + 0.8 * 24,000) = round(3,200 + 19,200) = 22,400ms -> ceil(22.4) = 23s.
    // It moves toward the new estimate (16s) by alpha (0.2) of the gap, never jumps fully.
    act(() => {
      useJevRunStore.getState().markCellSettled();
    });
    expect(banner().textContent).toContain('ETA: 23s');
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
