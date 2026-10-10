// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DEFAULT_LAYOUT, requestDashboardLayoutReset, useDashboardPanels } from '../useDashboardLayout';

describe('useDashboardPanels hydration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hydrates sizes from localStorage (2col)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 22 }));
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBe(22);
    expect(result.current.rightSize).toBe(0); // 2col has no right panel; 0 is the shape default
  });

  it('hydrates sizes from localStorage (3col)', async () => {
    window.localStorage.setItem('hex:layout:v1:3col', JSON.stringify({ sidebar: 15, right: 30 }));
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBe(15);
    expect(result.current.rightSize).toBe(30);
  });

  it('corrupt JSON -> defaults (undefined sizes)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', 'not-json{{{');
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBeUndefined();
    expect(result.current.rightSize).toBeUndefined();
  });

  it('out-of-range values rejected -> defaults', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 99 }));
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBeUndefined();
  });

  it('handleLayoutChanged persists valid layouts', async () => {
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    act(() => { result.current.handleLayoutChanged({ sidebar: 20, center: 50, right: 30 }); });
    expect(result.current.sidebarSize).toBe(20);
    expect(result.current.rightSize).toBe(30);
    expect(JSON.parse(window.localStorage.getItem('hex:layout:v1:3col') ?? '{}')).toEqual({ sidebar: 20, right: 30 });
  });

  it('handleLayoutChanged ignores invalid payloads', async () => {
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    act(() => { result.current.handleLayoutChanged({ center: 100 }); });
    expect(result.current.sidebarSize).toBeUndefined();
    expect(window.localStorage.getItem('hex:layout:v1:2col')).toBeNull();
  });

  it('persisted 3col sizes do not leak into a 2col -> 3col shape switch (PR #442 6b)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 24 }));
    window.localStorage.setItem('hex:layout:v1:3col', JSON.stringify({ sidebar: 12, right: 33 }));

    // Start as 2col: hydrates 2col's sidebar=24.
    const { result, rerender } = renderHook((props: { shape: '2col' | '3col' }) => useDashboardPanels(props.shape), {
      initialProps: { shape: '2col' as const },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBe(24);
    expect(result.current.rightSize).toBe(0); // 2col shape default

    // Switch to 3col: 2col's sidebar=24 is stale for the 3-panel group and
    // must not be applied; 3col's own persisted values hydrate instead.
    rerender({ shape: '3col' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.sidebarSize).toBe(12);
    expect(result.current.rightSize).toBe(33);
  });

  it('defaults are relative percentages: 3col 15 / 60 / 25, 2col 15 / 85 (ARTAS Vector 7)', () => {
    expect(DEFAULT_LAYOUT['3col']).toEqual({ sidebar: 15, right: 25 });
    expect(DEFAULT_LAYOUT['2col']).toEqual({ sidebar: 15, right: 0 });
    expect(100 - DEFAULT_LAYOUT['3col'].sidebar - DEFAULT_LAYOUT['3col'].right).toBe(60);
  });

  it('Reset Layout clears both stored shapes (TopBar circuit breaker)', () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 22 }));
    window.localStorage.setItem('hex:layout:v1:3col', JSON.stringify({ sidebar: 20, right: 30 }));
    requestDashboardLayoutReset();
    expect(window.localStorage.getItem('hex:layout:v1:2col')).toBeNull();
    expect(window.localStorage.getItem('hex:layout:v1:3col')).toBeNull();
  });
});
