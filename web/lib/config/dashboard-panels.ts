import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import {
  DEFAULT_LAYOUT,
  RIGHT_MAX,
  RIGHT_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type LayoutShape,
  type PanelDefaults,
} from '@/lib/types/dashboard-layout';

/**
 * Settings-Registry-driven default dashboard panel widths (ADR 042 follow-up,
 * T18). Keys: `ui.dashboard.panelWidths.2col` = [sidebar, center] and
 * `ui.dashboard.panelWidths.3col` = [sidebar, center, right], percents.
 * DEFAULT_LAYOUT is the code fallback: used when the registry is unreachable
 * or a stored value fails validation. Never hardcode these at call sites.
 */
const REGISTRY_KEYS = {
  '2col': 'ui.dashboard.panelWidths.2col',
  '3col': 'ui.dashboard.panelWidths.3col',
} as const satisfies Record<LayoutShape, string>;

const SUM_TOLERANCE = 0.01;

/** Parses one registry value; returns null when it is not a valid width tuple. */
export function parsePanelWidths(
  shape: LayoutShape,
  raw: unknown
): { sidebar: number; right: number } | null {
  const expectedLength = shape === '3col' ? 3 : 2;
  if (!Array.isArray(raw) || raw.length !== expectedLength) return null;
  if (!raw.every((width) => typeof width === 'number' && Number.isFinite(width))) return null;
  const widths = raw as number[];
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (Math.abs(total - 100) > SUM_TOLERANCE) return null;
  const [sidebar = NaN, , right = 0] = widths;
  if (sidebar < SIDEBAR_MIN || sidebar > SIDEBAR_MAX) return null;
  if (shape === '2col') return { sidebar, right: 0 };
  if (right < RIGHT_MIN || right > RIGHT_MAX) return null;
  return { sidebar, right };
}

/** Resolves both shapes' default widths in one Settings Registry round-trip. */
export async function resolveDashboardPanelDefaults(): Promise<PanelDefaults> {
  const fallbackRaw: Record<string, unknown> = {
    [REGISTRY_KEYS['2col']]: toTuple('2col', DEFAULT_LAYOUT['2col']),
    [REGISTRY_KEYS['3col']]: toTuple('3col', DEFAULT_LAYOUT['3col']),
  };
  try {
    const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
      Object.keys(fallbackRaw),
      fallbackRaw
    );
    return {
      '2col': parsePanelWidths('2col', resolved?.[REGISTRY_KEYS['2col']]) ?? DEFAULT_LAYOUT['2col'],
      '3col': parsePanelWidths('3col', resolved?.[REGISTRY_KEYS['3col']]) ?? DEFAULT_LAYOUT['3col'],
    };
  } catch (error) {
    // Fail soft: a registry outage must not 500 /dashboard; use the code defaults.
    console.warn('[dashboard-panels] resolveDashboardPanelDefaults failed, using code fallback:', error);
    return structuredClone(DEFAULT_LAYOUT);
  }
}

function toTuple(shape: LayoutShape, layout: { sidebar: number; right: number }): number[] {
  return shape === '3col'
    ? [layout.sidebar, 100 - layout.sidebar - layout.right, layout.right]
    : [layout.sidebar, 100 - layout.sidebar];
}
