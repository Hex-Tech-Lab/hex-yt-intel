import { describe, it, expect } from 'vitest';
import { clampSignalScore } from '@/lib/utils/signal-bar-clamp';

/**
 * Pure clamping logic behind SignalBarGroup's ARIA attributes (Cubic
 * review, 2026-08-05: aria-valuenow could go below 0 or above
 * aria-valuemax even though the visual ratio was already clamped).
 * DOM-free -- see the comment on clampSignalScore for why this repo's
 * test suite can't run @testing-library/react component tests.
 */
describe('clampSignalScore', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampSignalScore(5, 10)).toEqual({ normalizedScore: 5, normalizedMaxScore: 10 });
  });

  it('clamps a negative score to 0', () => {
    expect(clampSignalScore(-5, 10)).toEqual({ normalizedScore: 0, normalizedMaxScore: 10 });
  });

  it('clamps a score above maxScore down to maxScore', () => {
    expect(clampSignalScore(999, 10)).toEqual({ normalizedScore: 10, normalizedMaxScore: 10 });
  });

  it('falls back to the default maxScore (10) when maxScore is NaN', () => {
    expect(clampSignalScore(5, NaN)).toEqual({ normalizedScore: 5, normalizedMaxScore: 10 });
  });

  it('falls back to the default maxScore when maxScore is zero', () => {
    expect(clampSignalScore(5, 0)).toEqual({ normalizedScore: 5, normalizedMaxScore: 10 });
  });

  it('falls back to the default maxScore when maxScore is negative', () => {
    expect(clampSignalScore(5, -10)).toEqual({ normalizedScore: 5, normalizedMaxScore: 10 });
  });

  it('falls back to the default maxScore when maxScore is Infinity', () => {
    const { normalizedMaxScore } = clampSignalScore(5, Infinity);
    expect(normalizedMaxScore).toBe(10);
  });

  it('keeps normalizedScore within [0, normalizedMaxScore] for combined edge cases (-Infinity score, NaN maxScore)', () => {
    const { normalizedScore, normalizedMaxScore } = clampSignalScore(-Infinity, NaN);
    expect(Number.isFinite(normalizedScore)).toBe(true);
    expect(Number.isFinite(normalizedMaxScore)).toBe(true);
    expect(normalizedScore).toBeGreaterThanOrEqual(0);
    expect(normalizedScore).toBeLessThanOrEqual(normalizedMaxScore);
  });

  it('keeps normalizedScore within bounds when score is +Infinity', () => {
    const { normalizedScore, normalizedMaxScore } = clampSignalScore(Infinity, 10);
    expect(normalizedScore).toBe(0);
    expect(normalizedMaxScore).toBe(10);
  });
});
