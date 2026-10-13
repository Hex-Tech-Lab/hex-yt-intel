import { describe, expect, it } from 'vitest';
import { toGroupLayout } from './dashboard-layout';

describe('toGroupLayout', () => {
  it('3col: center takes the remainder, panels sum to 100', () => {
    const layout = toGroupLayout('3col', 18, 28);
    expect(layout).toEqual({ sidebar: 18, center: 54, right: 28 });
    expect(layout.sidebar + layout.center + layout.right).toBe(100);
  });
  it('2col: ignores right, panels sum to 100', () => {
    expect(toGroupLayout('2col', 18, 99)).toEqual({ sidebar: 18, center: 82 });
  });
});
