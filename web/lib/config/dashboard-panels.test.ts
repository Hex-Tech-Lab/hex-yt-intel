import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRegistrySettings = vi.fn();
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: (...args: unknown[]) => getRegistrySettings(...args) },
}));

import { DEFAULT_LAYOUT } from '@/lib/hooks/useDashboardLayout';
import { parsePanelWidths, resolveDashboardPanelDefaults } from './dashboard-panels';

/** Mimics the real adapter: registry value when present, otherwise the caller's fallback. */
function registryWith(values: Record<string, unknown>) {
  getRegistrySettings.mockImplementation((_keys: string[], fallback: Record<string, unknown>) =>
    Promise.resolve({
      ...fallback,
      ...values,
    })
  );
}

describe('resolveDashboardPanelDefaults', () => {
  beforeEach(() => {
    getRegistrySettings.mockReset();
  });

  it('uses the registry value when present', async () => {
    registryWith({
      'ui.dashboard.panelWidths.3col': [20, 50, 30],
      'ui.dashboard.panelWidths.2col': [22, 78],
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['3col']).toEqual({ sidebar: 20, right: 30 });
    expect(result['2col']).toEqual({ sidebar: 22, right: 0 });
  });

  it('falls back to the code default when the registry has no value', async () => {
    registryWith({});
    const result = await resolveDashboardPanelDefaults();
    expect(result).toEqual(DEFAULT_LAYOUT);
  });

  it('falls back to the code default when the stored value is invalid', async () => {
    registryWith({
      'ui.dashboard.panelWidths.3col': [50, 10, 40],
      'ui.dashboard.panelWidths.2col': [18, 50],
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['3col']).toEqual(DEFAULT_LAYOUT['3col']);
    expect(result['2col']).toEqual(DEFAULT_LAYOUT['2col']);
  });

  it('falls back to the code default when the registry throws an error', async () => {
    getRegistrySettings.mockRejectedValue(new Error('Network error'));
    const result = await resolveDashboardPanelDefaults();
    expect(result).toEqual(DEFAULT_LAYOUT);
  });
});

describe('parsePanelWidths', () => {
  it('rejects wrong length, non-numbers, and widths that do not sum to 100', () => {
    expect(parsePanelWidths('3col', [18, 82])).toBeNull();
    expect(parsePanelWidths('3col', ['18', 54, 28])).toBeNull();
    expect(parsePanelWidths('3col', [18, 54, 20])).toBeNull();
    expect(parsePanelWidths('3col', null)).toBeNull();
  });
});
