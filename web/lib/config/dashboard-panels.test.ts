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

  it('fails soft per shape: 2col valid while 3col is absent falls back 3col to DEFAULT_LAYOUT', async () => {
    registryWith({
      'ui.dashboard.panelWidths.2col': [24, 76],
      // 3col key absent
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['2col']).toEqual({ sidebar: 24, right: 0 });
    expect(result['3col']).toEqual(DEFAULT_LAYOUT['3col']);
  });

  it('fails soft per shape: 3col valid while 2col is absent falls back 2col to DEFAULT_LAYOUT', async () => {
    registryWith({
      // 2col key absent
      'ui.dashboard.panelWidths.3col': [16, 56, 28],
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['2col']).toEqual(DEFAULT_LAYOUT['2col']);
    expect(result['3col']).toEqual({ sidebar: 16, right: 28 });
  });

  it('fails soft per shape: 3col valid while 2col is invalid tuple (sums to 99) falls back 2col only', async () => {
    registryWith({
      'ui.dashboard.panelWidths.2col': [20, 79], // sums to 99 != 100
      'ui.dashboard.panelWidths.3col': [15, 60, 25],
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['2col']).toEqual(DEFAULT_LAYOUT['2col']);
    expect(result['3col']).toEqual({ sidebar: 15, right: 25 });
  });

  it('fails soft per shape: 2col valid while 3col is invalid tuple (sums to 99) falls back 3col only', async () => {
    registryWith({
      'ui.dashboard.panelWidths.2col': [22, 78],
      'ui.dashboard.panelWidths.3col': [18, 53, 28], // sums to 99 != 100
    });
    const result = await resolveDashboardPanelDefaults();
    expect(result['2col']).toEqual({ sidebar: 22, right: 0 });
    expect(result['3col']).toEqual(DEFAULT_LAYOUT['3col']);
  });
});

describe('parsePanelWidths', () => {
  it('rejects wrong length, non-numbers, and widths that do not sum to 100', () => {
    expect(parsePanelWidths('3col', [18, 82])).toBeNull();
    expect(parsePanelWidths('3col', ['18', 54, 28])).toBeNull();
    expect(parsePanelWidths('3col', [18, 54, 20])).toBeNull();
    expect(parsePanelWidths('3col', [18, 54, 27])).toBeNull(); // sums to 99
    expect(parsePanelWidths('2col', [18, 81])).toBeNull(); // sums to 99
    expect(parsePanelWidths('2col', [18, 54, 28])).toBeNull(); // wrong length for 2col
    expect(parsePanelWidths('3col', null)).toBeNull();
    expect(parsePanelWidths('2col', undefined)).toBeNull();
    expect(parsePanelWidths('3col', {})).toBeNull();
    expect(parsePanelWidths('2col', [NaN, 100])).toBeNull();
    expect(parsePanelWidths('3col', [18, Infinity, 28])).toBeNull();
  });

  it('rejects values outside min/max bounds', () => {
    expect(parsePanelWidths('2col', [9, 91])).toBeNull(); // sidebar < SIDEBAR_MIN (10)
    expect(parsePanelWidths('2col', [31, 69])).toBeNull(); // sidebar > SIDEBAR_MAX (30)
    expect(parsePanelWidths('3col', [18, 73, 9])).toBeNull(); // right < RIGHT_MIN (10)
    expect(parsePanelWidths('3col', [18, 46, 36])).toBeNull(); // right > RIGHT_MAX (35)
  });

  it('parses valid 2col and 3col tuples', () => {
    expect(parsePanelWidths('2col', [20, 80])).toEqual({ sidebar: 20, right: 0 });
    expect(parsePanelWidths('3col', [20, 50, 30])).toEqual({ sidebar: 20, right: 30 });
  });
});
