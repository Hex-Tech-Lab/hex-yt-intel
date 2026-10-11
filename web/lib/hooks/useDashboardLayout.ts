'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Resizable desktop panel layout for DashboardLayout (PR #442, Task 4).
 *
 * One storage key PER layout shape: the right panel is optional
 * (`rightPanel` prop), so a 2-column desktop must never inherit sizes
 * written by the 3-column desktop and vice versa -- percentages would
 * silently collide across different panel counts.
 *
 * Defaults are percentages: 3-column 15% / 60% / 25%, 2-column 15% / 85%.
 * react-resizable-panels v4 reads a bare number as PIXELS, so every size
 * handed to a Group must be a percentage (see toGroupLayout).
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

/**
 * Panel-id -> percent layout for a Group, with center taking the remainder
 * so the panels always sum to 100. Single source for both the mount-time
 * defaultLayout and the Reset Layout setLayout call.
 */
export function toGroupLayout(
  shape: LayoutShape,
  sidebar: number,
  right: number
): Record<string, number> {
  return shape === '3col'
    ? { sidebar, center: 100 - sidebar - right, right }
    : { sidebar, center: 100 - sidebar };
}

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

  // Layout effect: runs before paint, so the desktop Group mounts with the
  // right breakpoint state on its first visible frame.
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
  /** True once the saved layouts for BOTH shapes are read (before first paint). */
  hydrated: boolean;
  /** Percent layout for the active shape: saved sizes when present, else DEFAULT_LAYOUT. */
  groupLayout: Record<string, number>;
  /** Percent layout for BOTH shapes, so a shape switch can apply the other one without a remount. */
  layouts: Record<LayoutShape, Record<string, number>>;
  /** Persist on `Group`'s `onLayoutChanged`. Ignores reports whose panel ids belong to the other shape. */
  handleLayoutChanged: (layout: { [panelId: string]: number }) => void;
  /** Reset Layout: clears both keys and snaps back to defaults immediately. */
  resetLayout: () => void;
}

type SavedLayouts = Record<LayoutShape, { sidebar: number; right: number } | null>;

export function useDashboardPanels(shape: LayoutShape): UseDashboardPanelsResult {
  const isDesktop = useIsDesktop();
  // Both shapes are read once, before the Group mounts, so a 2col<->3col
  // switch already has its saved sizes in memory and never falls back to
  // defaults. Null until that read happens (SSR and first client render).
  const [saved, setSaved] = useState<SavedLayouts | null>(null);

  // Layout effect, not useEffect: the saved sizes must be in state before the
  // Group mounts (Group reads defaultLayout once, at mount) and before paint.
  useLayoutEffect(() => {
    setSaved({ '2col': readPersistedLayout('2col'), '3col': readPersistedLayout('3col') });
  }, []);

  const handleLayoutChanged = useCallback(
    (layout: { [panelId: string]: number }) => {
      const sidebar = layout.sidebar;
      if (typeof sidebar !== 'number' || !Number.isFinite(sidebar)) return;
      // The library can report the other shape's group during a switch. A
      // report belongs to this shape only if its panel ids match it.
      if (shape === '2col' && 'right' in layout) return;
      if (shape === '3col' && typeof layout.right !== 'number') return;
      const right = shape === '3col' ? (layout.right as number) : 0;
      if (!Number.isFinite(right)) return;
      persistLayout(shape, sidebar, right);
      setSaved((prev) => (prev ? { ...prev, [shape]: { sidebar, right } } : prev));
    },
    [shape]
  );

  const resetLayout = useCallback(() => requestDashboardLayoutReset(), []);

  // Reset Layout clears storage and the live Group. Drop the in-memory copy
  // too, or the next shape switch would re-apply the pre-reset sizes.
  useEffect(() => {
    const clear = () => {
      setSaved((prev) => (prev ? { '2col': null, '3col': null } : prev));
    };
    resetListeners.add(clear);
    return () => {
      resetListeners.delete(clear);
    };
  }, []);

  const layoutFor = (target: LayoutShape): Record<string, number> => {
    const current = saved?.[target] ?? null;
    return toGroupLayout(
      target,
      current?.sidebar ?? DEFAULT_LAYOUT[target].sidebar,
      current?.right ?? DEFAULT_LAYOUT[target].right
    );
  };
  const layouts = { '2col': layoutFor('2col'), '3col': layoutFor('3col') };
  const groupLayout = layouts[shape];

  return {
    isDesktop,
    hydrated: saved !== null,
    groupLayout,
    layouts,
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

// Hooks subscribe here to drop their in-memory copy of the saved layouts.
const resetListeners = new Set<() => void>();

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
  resetListeners.forEach((listener) => {
    listener();
  });
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
