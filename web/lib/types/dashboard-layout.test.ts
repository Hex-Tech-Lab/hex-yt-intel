import { describe, expect, it } from 'vitest';
import { toGroupLayout } from './dashboard-layout';

describe('toGroupLayout', () => {
  it('3col: center takes the remainder, panels sum to 100', () => {
    const l = toGroupLayout('3col', 18, 28);
    expect(l).toEqual({ sidebar: 18, center: 54, right: 28 });
    expect(l.sidebar + l.center + l.right).toBe(100);
  });
  it('2col: ignores right, panels sum to 100', () => {
    expect(toGroupLayout('2col', 18, 99)).toEqual({ sidebar: 18, center: 82 });
  });
});
