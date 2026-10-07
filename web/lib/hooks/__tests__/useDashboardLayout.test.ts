// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerResetSink,
  requestDashboardLayoutReset,
  readStoredLayoutForTest,
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
