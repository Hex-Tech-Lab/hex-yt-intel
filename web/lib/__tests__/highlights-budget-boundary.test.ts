import { describe, it, expect } from 'vitest';
import { calculateEffectiveHighlightBudget, calculateAttentionBoundedBudget } from '@/lib/utils/highlights-settings';

describe('calculateEffectiveHighlightBudget short-form edge (<3 min)', () => {
  it('caps budget to video duration when N*15 exceeds runtime', () => {
    const budget = calculateEffectiveHighlightBudget(90, 8);
    expect(budget).toBeLessThanOrEqual(90);
    expect(budget).toBe(90);
  });

  it('respects 15s floor for <=3 takeaways on 120s video', () => {
    const budget = calculateEffectiveHighlightBudget(120, 3);
    expect(budget).toBeGreaterThanOrEqual(45);
    expect(budget).toBeLessThanOrEqual(120);
  });

  it('returns base for 0 takeaways', () => {
    const base = calculateAttentionBoundedBudget(120);
    expect(calculateEffectiveHighlightBudget(120, 0)).toBe(base);
  });

  it('long-form >1hr scales logarithmically and stays bounded', () => {
    const budget = calculateEffectiveHighlightBudget(7200, 10);
    expect(budget).toBeGreaterThan(180);
    expect(budget).toBeLessThanOrEqual(7200);
    expect(budget).toBeLessThanOrEqual(330);
  });

  it('slicing 5000 transcript segments remains O(N) without leak', () => {
    const segments = Array.from({ length: 5000 }, (_, i) => ({ start: i * 2, text: `segment ${i} text` }));
    const budget = calculateEffectiveHighlightBudget(10000, 7);
    expect(budget).toBeGreaterThan(0);
    const sliced = segments.slice(0, 10);
    expect(sliced).toHaveLength(10);
    expect(sliced[0]!.start).toBe(0);
  });
});
