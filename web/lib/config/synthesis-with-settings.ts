/**
 * Synthesis configuration using settings context.
 * Provides hooks and utilities to access synthesis config from admin_settings table.
 * Falls back to hard-coded defaults if settings not yet loaded.
 */

'use client';

import { useAdminSettings } from '@/lib/stores/settings-context';
import { TOTAL_DIMENSIONS as DEFAULT_TOTAL_DIMENSIONS, STREAM_BUNDLES as DEFAULT_STREAM_BUNDLES, DIMENSION_CONFIGS as DEFAULT_DIMENSION_CONFIGS, MIN_USABLE_DIMENSIONS as DEFAULT_MIN_USABLE_DIMENSIONS, ABORT_ON_PARTIAL_FAILURE as DEFAULT_ABORT_ON_PARTIAL_FAILURE } from './synthesis';
import type { DimensionConfig } from '@/lib/types/settings';

/**
 * Hook to get synthesis configuration from settings context.
 * Returns settings-based values, falling back to hard-coded defaults if settings not loaded.
 */
function mergeDimensionConfigs(
  fromDb: Partial<Record<number, Partial<DimensionConfig>>> | undefined
): Record<number, DimensionConfig> {
  if (!fromDb) return DEFAULT_DIMENSION_CONFIGS;
  const merged: Record<number, DimensionConfig> = { ...DEFAULT_DIMENSION_CONFIGS };
  for (const [key, value] of Object.entries(fromDb)) {
    const num = Number(key);
    const base = DEFAULT_DIMENSION_CONFIGS[num];
    merged[num] = base ? { ...base, ...value } : (value as DimensionConfig);
  }
  return merged;
}

export function useSynthesisConfig() {
  const adminSettings = useAdminSettings();

  return {
    // Total number of CORE dimensions (1-11)
    totalDimensions: adminSettings?.totalDimensions ?? DEFAULT_TOTAL_DIMENSIONS,

    // Total number of streaming bundles
    totalStreams: adminSettings?.streamBundles?.length ?? 5,

    // Minimum dimensions for "usable" analysis
    minUsableDimensions: adminSettings?.minUsableDimensions ?? DEFAULT_MIN_USABLE_DIMENSIONS,

    // Stream bundle configuration (dimensions grouped for parallel streaming)
    streamBundles: adminSettings?.streamBundles?.map(b => b.dimensions) ?? DEFAULT_STREAM_BUNDLES,

    // Dimension metadata and display names. Per-key merge (not whole-object fallback):
    // a DB row missing a field (e.g. icon) on one dimension must not blank out that
    // field for every dimension — each dimension's config falls back to its own default.
    dimensionConfigs: mergeDimensionConfigs(adminSettings?.dimensionConfigs),

    // Whether to abort all streams if one fails
    abortOnPartialFailure: adminSettings?.abortOnPartialFailure ?? DEFAULT_ABORT_ON_PARTIAL_FAILURE,

    // Model routing
    modelCascade: adminSettings?.modelCascade ?? ['nemotron-3-nano', 'claude-haiku-4-5'],

    // Timeout configuration
    connectionHandshakeTimeoutMs: adminSettings?.connectionHandshakeTimeoutMs ?? 3000,
    tokenStreamingWindowMs: adminSettings?.tokenStreamingWindowMs ?? 25000,

    // Retry configuration
    maxRetries: adminSettings?.maxRetries ?? 3,
    retryBackoffMs: adminSettings?.retryBackoffMs ?? 1000,
  };
}

/**
 * Get TOTAL_DIMENSIONS for use in client components.
 * Use in conjunction with useSynthesisConfig().
 */
export function useTotalDimensions(): number {
  const { totalDimensions } = useSynthesisConfig();
  return totalDimensions;
}

/**
 * Get STREAM_BUNDLES for use in client components.
 * Use in conjunction with useSynthesisConfig().
 */
export function useStreamBundles(): number[][] {
  const { streamBundles } = useSynthesisConfig();
  return streamBundles;
}

/**
 * Get DIMENSION_CONFIGS for use in client components.
 * Use in conjunction with useSynthesisConfig().
 */
export function useDimensionConfigs(): Record<number, DimensionConfig> {
  const { dimensionConfigs } = useSynthesisConfig();
  return dimensionConfigs;
}

/**
 * Get MIN_USABLE_DIMENSIONS for use in client components.
 * Use in conjunction with useSynthesisConfig().
 */
export function useMinUsableDimensions(): number {
  const { minUsableDimensions } = useSynthesisConfig();
  return minUsableDimensions;
}

/**
 * Get ABORT_ON_PARTIAL_FAILURE for use in client components.
 * Use in conjunction with useSynthesisConfig().
 */
export function useAbortOnPartialFailure(): boolean {
  const { abortOnPartialFailure } = useSynthesisConfig();
  return abortOnPartialFailure;
}
