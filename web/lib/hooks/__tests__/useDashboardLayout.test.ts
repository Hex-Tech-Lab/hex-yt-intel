// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_LAYOUT,
  registerResetSink,
  requestDashboardLayoutReset,
  readStoredLayoutForTest,
  toGroupLayout,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  RIGHT_MIN,
  RIGHT_MAX,
} from '../useDashboardLayout';

const KEY_2COL = 'hex:layout:v1:2col';
const KEY_3COL = 'hex:layout:v1:3col';

function setItem(key: string, value: string): void {
  window.localStorage.setItem(key, value);
}

describe('dashboard layout persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    registerResetSink(null);
    vi.unstubAllGlobals();
  });

  it('readStoredLayoutForTest returns the stored JSON string', () => {
    setItem(KEY_2COL, JSON.stringify({ sidebar: 22, right: 25 }));
    expect(readStoredLayoutForTest('2col')).toBe(JSON.stringify({ sidebar: 22, right: 25 }));
  });

  it('readStoredLayoutForTest returns null for missing key', () => {
    expect(readStoredLayoutForTest('3col')).toBeNull();
  });

  it('readStoredLayoutForTest survives a throwing localStorage (corrupt store)', () => {
    const original = window.localStorage;
    vi.stubGlobal(
      'localStorage',
      Object.assign(Object.create(Object.getPrototypeOf(original)), {
        getItem() {
          throw new Error('SecurityError');
        },
      })
    );
    expect(readStoredLayoutForTest('2col')).toBeNull();
  });

  it('requestDashboardLayoutReset clears both shape keys and calls the registered sink', () => {
    setItem(KEY_2COL, JSON.stringify({ sidebar: 30 }));
    setItem(KEY_3COL, JSON.stringify({ sidebar: 10, right: 35 }));

    const shapes: string[] = [];
    registerResetSink((shape) => {
      shapes.push(shape);
    });

    requestDashboardLayoutReset();

    expect(window.localStorage.getItem(KEY_2COL)).toBeNull();
    expect(window.localStorage.getItem(KEY_3COL)).toBeNull();
    expect(shapes).toEqual(['2col', '3col']);
  });

  it('requestDashboardLayoutReset is a safe no-op when no sink is registered', () => {
    setItem(KEY_2COL, JSON.stringify({ sidebar: 30 }));
    expect(() => requestDashboardLayoutReset()).not.toThrow();
    expect(window.localStorage.getItem(KEY_2COL)).toBeNull();
  });
});

describe('toGroupLayout', () => {
  it('3col: sidebar/center/right in percent, summing to 100', () => {
    const layout = toGroupLayout('3col', 15, 25);
    expect(layout).toEqual({ sidebar: 15, center: 60, right: 25 });
    expect(Object.values(layout).reduce((total, percent) => total + percent, 0)).toBe(100);
  });

  it('2col: sidebar/center only, no right key', () => {
    const layout = toGroupLayout('2col', 15, 0);
    expect(layout).toEqual({ sidebar: 15, center: 85 });
    expect(layout).not.toHaveProperty('right');
  });

  it('default 3col and 2col layouts are 18/54/28 and 18/82', () => {
    expect(toGroupLayout('3col', DEFAULT_LAYOUT['3col'].sidebar, DEFAULT_LAYOUT['3col'].right))
      .toEqual({ sidebar: 18, center: 54, right: 28 });
    expect(toGroupLayout('2col', DEFAULT_LAYOUT['2col'].sidebar, DEFAULT_LAYOUT['2col'].right))
      .toEqual({ sidebar: 18, center: 82 });
  });
});

describe('DEFAULT_LAYOUT bounds', () => {
  it('every default sits inside the panel min/max, so it is never clamped or rejected as out-of-range', () => {
    for (const shape of ['2col', '3col'] as const) {
      const { sidebar, right } = DEFAULT_LAYOUT[shape];
      expect(sidebar).toBeGreaterThanOrEqual(SIDEBAR_MIN);
      expect(sidebar).toBeLessThanOrEqual(SIDEBAR_MAX);
      if (shape === '3col') {
        expect(right).toBeGreaterThanOrEqual(RIGHT_MIN);
        expect(right).toBeLessThanOrEqual(RIGHT_MAX);
      }
    }
  });
});
