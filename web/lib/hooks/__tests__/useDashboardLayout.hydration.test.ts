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
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.sidebarSize).toBe(22);
    expect(result.current.rightSize).toBe(0); // 2col has no right panel; 0 is the shape default
  });

  it('hydrates sizes from localStorage (3col)', async () => {
    window.localStorage.setItem('hex:layout:v1:3col', JSON.stringify({ sidebar: 15, right: 30 }));
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.sidebarSize).toBe(15);
    expect(result.current.rightSize).toBe(30);
  });

  it('corrupt JSON -> defaults (undefined sizes)', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', 'not-json{{{');
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.sidebarSize).toBeUndefined();
    expect(result.current.rightSize).toBeUndefined();
  });

  it('out-of-range values rejected -> defaults', async () => {
    window.localStorage.setItem('hex:layout:v1:2col', JSON.stringify({ sidebar: 99 }));
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.sidebarSize).toBeUndefined();
  });

  it('handleLayoutChanged persists valid layouts', async () => {
    const { result } = renderHook(() => useDashboardPanels('3col'));
    await new Promise(r => setTimeout(r, 20));
    act(() => { result.current.handleLayoutChanged({ sidebar: 20, center: 50, right: 30 }); });
    expect(result.current.sidebarSize).toBe(20);
    expect(result.current.rightSize).toBe(30);
    expect(JSON.parse(window.localStorage.getItem('hex:layout:v1:3col') ?? '{}')).toEqual({ sidebar: 20, right: 30 });
  });

  it('handleLayoutChanged ignores invalid payloads', async () => {
    const { result } = renderHook(() => useDashboardPanels('2col'));
    await new Promise(r => setTimeout(r, 20));
    act(() => { result.current.handleLayoutChanged({ center: 100 }); });
    expect(result.current.sidebarSize).toBeUndefined();
    expect(window.localStorage.getItem('hex:layout:v1:2col')).toBeNull();
  });
});
