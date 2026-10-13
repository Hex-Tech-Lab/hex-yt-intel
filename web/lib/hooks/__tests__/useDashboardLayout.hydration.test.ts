// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDashboardPanels } from '../useDashboardLayout';

describe('useDashboardPanels hydration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hydrates sizes from localStorage (2col)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 22 }));
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 22, center: 78 }); // 2col: no right panel
  });

  it('hydrates sizes from localStorage (3col)', async () => {
    window.localStorage.setItem('hex:layout:v1:3col', JSON.stringify({ sidebar: 15, right: 30 }));
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 15, center: 55, right: 30 });
  });

  it('corrupt JSON -> defaults (undefined sizes)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', 'not-json{{{');
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 18, center: 82 }); // 2col defaults
  });

  it('out-of-range values rejected -> defaults', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 99 }));
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 18, center: 82 });
  });

  it('handleLayoutChanged persists valid layouts', async () => {
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    act(() => { result.current.handleLayoutChanged({ sidebar: 20, center: 50, right: 30 }); });
    expect(result.current.groupLayout).toEqual({ sidebar: 20, center: 50, right: 30 });
    expect(JSON.parse(window.localStorage.getItem('hex:layout:v1:3col') ?? '{}')).toEqual({ sidebar: 20, right: 30 });
  });

  it('handleLayoutChanged ignores invalid payloads', async () => {
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    act(() => { result.current.handleLayoutChanged({ center: 100 }); });
    expect(result.current.groupLayout).toEqual({ sidebar: 18, center: 82 });
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
    expect(result.current.groupLayout).toEqual({ sidebar: 24, center: 76 });

    // Switch to 3col: 2col's sidebar=24 is stale for the 3-panel group and
    // must not be applied; 3col's own persisted values hydrate instead.
    rerender({ shape: '3col' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 12, center: 55, right: 33 });
  });

  it('falls back to DEFAULT_LAYOUT when defaults prop is undefined or has missing target shape (defaults?.[target] branch)', async () => {
    // Pass undefined explicitly for defaults to exercise defaults?.[target] ?? DEFAULT_LAYOUT[target]
    // @ts-expect-error testing runtime fallback when defaults is undefined
    const { result } = renderHook(() => useDashboardPanels('2col', undefined));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.groupLayout).toEqual({ sidebar: 18, center: 82 });
    expect(result.current.layouts['3col']).toEqual({ sidebar: 18, center: 54, right: 28 });
  });

  it('uses custom defaults when provided and falls back to DEFAULT_LAYOUT for missing shape', async () => {
    // Custom defaults provided for 2col only
    const customDefaults = {
      '2col': { sidebar: 25, right: 0 },
    };
    // @ts-expect-error testing runtime fallback when target shape is absent from defaults
    const { result } = renderHook(() => useDashboardPanels('2col', customDefaults));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 2col uses provided defaults
    expect(result.current.groupLayout).toEqual({ sidebar: 25, center: 75 });
    // 3col missing from defaults falls back via defaults?.[target] ?? DEFAULT_LAYOUT[target]
    expect(result.current.layouts['3col']).toEqual({ sidebar: 18, center: 54, right: 28 });
  });
});

