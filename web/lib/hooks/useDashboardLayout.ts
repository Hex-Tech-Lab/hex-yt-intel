'use client';

import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Resizable desktop panel layout for DashboardLayout (PR #442, Task 4).
 *
 * One storage key PER layout shape: the right panel is optional
 * (`rightPanel` prop), so a 2-column desktop must never inherit sizes
 * written by the 3-column desktop and vice versa -- percentages would
 * silently collide across different panel counts.
 *
 * Defaults are relative percentages: left 15% / center 60% / right 25% in the
 * 3-column layout, left 15% / center 85% in the 2-column layout. These are
 * percentages on purpose. react-resizable-panels treats a numeric defaultSize
 * as PIXELS (v4), so a bare `18` produced an 18px panel, clamped up to the
 * 10% minimum and read as a collapsed column (ARTAS Vector 7).
 *
 * All storage access is try/catch wrapped: private-mode browsing and
 * quota errors must never break render, and a corrupt value falls back
 * to defaults. SSR-safety: the persisted layout is only read in an
 * effect (post-hydration), so first client render always uses defaults
 * -- no hydration mismatch.
 */

export const LAYOUT_STORAGE_PREFIX = 'hex:layout:v1:';

export type LayoutShape = '2col' | '3col';

export const DEFAULT_LAYOUT: Record<LayoutShape, { sidebar: number; right: number }> = {
  '2col': { sidebar: 15, right: 0 },
  '3col': { sidebar: 15, right: 25 },
};

export const SIDEBAR_MIN = 10;
export const SIDEBAR_MAX = 30;
export const RIGHT_MIN = 10;
export const RIGHT_MAX = 35;

function storageKey(shape: LayoutShape): string {
  return `${LAYOUT_STORAGE_PREFIX}${shape}`;
}

export function readPersistedLayout(shape: LayoutShape): { sidebar: number; right: number } | null {
  try {
    const raw = window.localStorage.getItem(storageKey(shape));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const sidebar = record.sidebar;
    const right = shape === '3col' ? record.right : DEFAULT_LAYOUT[shape].right;
    if (
      typeof sidebar !== 'number' ||
      !Number.isFinite(sidebar) ||
      sidebar < SIDEBAR_MIN ||
      sidebar > SIDEBAR_MAX
    ) {
      return null;
    }
    if (
      shape === '3col' &&
      (typeof right !== 'number' || !Number.isFinite(right) || right < RIGHT_MIN || right > RIGHT_MAX)
    ) {
      return null;
    }
    return { sidebar, right: right as number };
  } catch (error) {
    console.error('[DashboardLayout]', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function persistLayout(shape: LayoutShape, sidebar: number, right: number): void {
  try {
    const value = shape === '3col' ? { sidebar, right } : { sidebar };
    window.localStorage.setItem(storageKey(shape), JSON.stringify(value));
  } catch (error) {
    console.error('[DashboardLayout]', error instanceof Error ? error.message : String(error));
  }
}

export function clearPersistedLayouts(): void {
  try {
    window.localStorage.removeItem(storageKey('2col'));
    window.localStorage.removeItem(storageKey('3col'));
  } catch (error) {
    console.error('[DashboardLayout]', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Tracks the `(min-width: 1280px)` xl breakpoint. SSR-safe: returns false
 * during SSR and the first client render, then syncs in an effect (no
 * hydration mismatch; the below-xl drawer tree stays the server default
 * and the panel group mounts only after hydration on desktop).
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  // Layout effect: the desktop panel group mounts before the browser paints,
  // so the saved layout is applied on the first visible frame.
  useLayoutEffect(() => {
    const mql = window.matchMedia('(min-width: 1280px)');
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

export interface UseDashboardPanelsResult {
  isDesktop: boolean;
  /** Active-shape sizes, hydrated from storage (defaults pre-hydration). */
  sidebarSize: number | undefined;
  rightSize: number | undefined;
  /** Persist on `Group`'s `onLayoutChanged` (Layout: panelId -> percent); also mirrors into ref state. */
  handleLayoutChanged: (layout: { [panelId: string]: number }) => void;
  /** Reset Layout: clears both keys and snaps back to defaults immediately. */
  resetLayout: () => void;
}

export function useDashboardPanels(shape: LayoutShape): UseDashboardPanelsResult {
  const isDesktop = useIsDesktop();
  // Undefined until hydrated: Group then falls back to its own
  // defaultSize props (which mirror the historic fixed grid).
  const [sizes, setSizes] = useState<{ shape: LayoutShape; sidebar?: number; right?: number }>({
    shape,
  });

  // Layout effect, same batch as useIsDesktop: the saved sizes are in state
  // before the Group mounts and before the first paint.
  useLayoutEffect(() => {
    setSizes({ shape, ...(readPersistedLayout(shape) ?? {}) });
  }, [shape]);

  const handleLayoutChanged = useCallback(
    (layout: { [panelId: string]: number }) => {
      const sidebar = layout.sidebar;
      if (typeof sidebar !== 'number' || !Number.isFinite(sidebar)) return;
      const right = shape === '3col' ? layout.right : undefined;
      if (shape === '3col' && (typeof right !== 'number' || !Number.isFinite(right))) return;
      setSizes({ shape, ...(shape === '3col' ? { sidebar, right: right as number } : { sidebar }) });
      persistLayout(shape, sidebar, typeof right === 'number' ? right : 0);
    },
    [shape]
  );

  const resetLayout = useCallback(() => {
    clearPersistedLayouts();
    setSizes({ shape });
    // Snap the live Group back to defaults via the panels' imperative
    // handles (registered below through the shared reset sink).
    resetSink?.(shape);
  }, [shape]);

  return {
    isDesktop,
    // Sizes are tagged with the shape that produced them; when the shape
    // switches (rightPanel toggles), the pending sizes are stale and must
    // NOT leak into the other shape's panel group (PR #442 review 6b).
    sidebarSize: sizes.shape === shape ? sizes.sidebar : undefined,
    rightSize: sizes.shape === shape ? sizes.right : undefined,
    handleLayoutChanged,
    resetLayout,
  };
}

/**
 * Shared module-level bridge so `useDashboardPanels` can command the
 * live Group without threading refs through context. Registered by the
 * Group host inside DashboardLayout; a single DashboardLayout is ever
 * mounted at once, so a single-slot sink is sufficient.
 */
export type ResetSink = (shape: LayoutShape) => void;
let resetSink: ResetSink | null = null;
export function registerResetSink(sink: ResetSink | null): void {
  resetSink = sink;
}

/**
 * TopBar-facing entry point for the header's Reset Layout button:
 * clears BOTH shape keys and snaps the live Group (if mounted) back to
 * its defaults. No-ops safely when the desktop panel group is not
 * mounted (below-xl / SSR).
 */
export function requestDashboardLayoutReset(): void {
  clearPersistedLayouts();
  resetSink?.('2col');
  resetSink?.('3col');
}

/**
 * Snapshot of the last persisted layout, used by tests and the Reset
 * flow to verify persistence without reaching into component internals.
 */
export function readStoredLayoutForTest(shape: LayoutShape): string | null {
  try {
    return window.localStorage.getItem(storageKey(shape));
  } catch (error) {
    console.error('[DashboardLayout]', error instanceof Error ? error.message : String(error));
    return null;
  }
}
