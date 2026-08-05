import { render } from '@testing-library/react';
import { SignalBarGroup } from '@/components/SignalBarGroup';
import { expect, describe, it } from 'vitest';

/**
 * Unit tests for SignalBarGroup component
 * Verifies aria-value* attributes stay clamped/finite even when score/maxScore
 * props are out of range, mirroring the visual ratio clamping (Cubic review finding).
 */
describe('SignalBarGroup', () => {
  function getMeter(container: HTMLElement) {
    const meter = container.querySelector('[role="meter"]');
    expect(meter).toBeTruthy();
    return meter as HTMLElement;
  }

  it('renders normal in-range values unchanged', () => {
    const { container } = render(<SignalBarGroup score={5} maxScore={10} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
    expect(meter.getAttribute('aria-valuenow')).toBe('5');
  });

  it('clamps a negative score to 0', () => {
    const { container } = render(<SignalBarGroup score={-5} maxScore={10} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuenow')).toBe('0');
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
  });

  it('clamps a score above maxScore down to maxScore', () => {
    const { container } = render(<SignalBarGroup score={999} maxScore={10} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuenow')).toBe('10');
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
  });

  it('falls back to the default maxScore when maxScore is NaN', () => {
    const { container } = render(<SignalBarGroup score={5} maxScore={NaN} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
    expect(Number.isFinite(Number(meter.getAttribute('aria-valuemax')))).toBe(true);
  });

  it('falls back to the default maxScore when maxScore is zero', () => {
    const { container } = render(<SignalBarGroup score={5} maxScore={0} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
  });

  it('falls back to the default maxScore when maxScore is negative', () => {
    const { container } = render(<SignalBarGroup score={5} maxScore={-10} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
  });

  it('falls back to the default maxScore when maxScore is Infinity', () => {
    const { container } = render(<SignalBarGroup score={5} maxScore={Infinity} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuemax')).toBe('10');
    expect(Number.isFinite(Number(meter.getAttribute('aria-valuemax')))).toBe(true);
  });

  it('keeps aria-valuenow within [0, aria-valuemax] for combined edge cases', () => {
    const { container } = render(<SignalBarGroup score={-Infinity} maxScore={NaN} />);
    const meter = getMeter(container);
    const now = Number(meter.getAttribute('aria-valuenow'));
    const max = Number(meter.getAttribute('aria-valuemax'));
    expect(Number.isFinite(now)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(max);
  });

  it('keeps aria-valuetext consistent with the clamped values', () => {
    const { container } = render(<SignalBarGroup score={999} maxScore={0} />);
    const meter = getMeter(container);
    expect(meter.getAttribute('aria-valuetext')).toBe('10.0 out of 10');
  });
});
