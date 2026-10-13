/**
 * Server-safe layout types and constants. No React, no 'use client', so server
 * modules (dashboard-panels.ts) can import them; useDashboardLayout re-exports them.
 */
export type LayoutShape = '2col' | '3col';

/** Code fallback; the Settings Registry (`ui.dashboard.panelWidths.*`) overrides these via resolveDashboardPanelDefaults. */
export type PanelDefaults = Record<LayoutShape, { sidebar: number; right: number }>;

export const DEFAULT_LAYOUT: Record<LayoutShape, { sidebar: number; right: number }> = {
  '2col': { sidebar: 18, right: 0 },
  '3col': { sidebar: 18, right: 28 },
};

export const SIDEBAR_MIN = 10;
export const SIDEBAR_MAX = 30;
export const RIGHT_MIN = 10;
export const RIGHT_MAX = 35;

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
