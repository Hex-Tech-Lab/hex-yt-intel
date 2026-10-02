/**
 * Jev semantic chunking configuration (ADR 037, R3b step 1).
 *
 * All 14 tunables live in the Settings Registry under `analysis.jev.*`;
 * this module is the typed resolver over the registry's raw values,
 * following the clamp/fallback pattern of `resolvePriorPayloadMaxBytes`
 * in `./prior-payload.ts`.
 */

export interface JevConfig {
  enabled: boolean;
  windowWords: number;
  windowStrideWords: number;
  deltaCdiThreshold: number;
  fluffCdiThreshold: number;
  minChunkTokens: number;
  maxChunkTokens: number;
  maxChunks: number;
  acronymMinLength: number;
  contentWordMinLength: number;
  countAcronyms: boolean;
  countProperNouns: boolean;
  countNumbers: boolean;
  countContentWords: boolean;
}

export const JEV_DEFAULTS: JevConfig = {
  enabled: false,
  windowWords: 100,
  windowStrideWords: 100,
  deltaCdiThreshold: 0.08,
  fluffCdiThreshold: 0.05,
  minChunkTokens: 1500,
  maxChunkTokens: 6000,
  maxChunks: 8,
  acronymMinLength: 2,
  contentWordMinLength: 4,
  countAcronyms: true,
  countProperNouns: true,
  countNumbers: true,
  countContentWords: true,
};

export const JEV_BOUNDS = {
  windowWords: { min: 20, max: 1000 },
  windowStrideWords: { min: 10, max: 1000 },
  deltaCdiThreshold: { min: 0, max: 1 },
  fluffCdiThreshold: { min: 0, max: 1 },
  minChunkTokens: { min: 100, max: 50000 },
  maxChunkTokens: { min: 200, max: 100000 },
  // 16 x 4 grounded bundles = 64 cells = /stream-tokens MAX_CELLS_PER_WAVE.
  maxChunks: { min: 1, max: 16 },
  acronymMinLength: { min: 2, max: 6 },
  contentWordMinLength: { min: 1, max: 12 },
  maxParallelStreams: { min: 1, max: 32 },
} as const;

export const JEV_MAX_PARALLEL_STREAMS_FALLBACK = 6;

/** Registry value of `analysis.jev.maxParallelStreams` → an integer in [min, max]; non-numeric → fallback. */
export function resolveJevMaxParallelStreams(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return JEV_MAX_PARALLEL_STREAMS_FALLBACK;
  const { min, max } = JEV_BOUNDS.maxParallelStreams;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

interface NumericSpec {
  key: string;
  min: number;
  max: number;
  floor?: boolean;
}

const NUMERIC_SPECS: NumericSpec[] = [
  { key: 'analysis.jev.windowWords', min: JEV_BOUNDS.windowWords.min, max: JEV_BOUNDS.windowWords.max, floor: true },
  { key: 'analysis.jev.windowStrideWords', min: JEV_BOUNDS.windowStrideWords.min, max: JEV_BOUNDS.windowStrideWords.max, floor: true },
  { key: 'analysis.jev.deltaCdiThreshold', min: JEV_BOUNDS.deltaCdiThreshold.min, max: JEV_BOUNDS.deltaCdiThreshold.max },
  { key: 'analysis.jev.fluffCdiThreshold', min: JEV_BOUNDS.fluffCdiThreshold.min, max: JEV_BOUNDS.fluffCdiThreshold.max },
  { key: 'analysis.jev.minChunkTokens', min: JEV_BOUNDS.minChunkTokens.min, max: JEV_BOUNDS.minChunkTokens.max, floor: true },
  { key: 'analysis.jev.maxChunkTokens', min: JEV_BOUNDS.maxChunkTokens.min, max: JEV_BOUNDS.maxChunkTokens.max, floor: true },
  { key: 'analysis.jev.maxChunks', min: JEV_BOUNDS.maxChunks.min, max: JEV_BOUNDS.maxChunks.max, floor: true },
  { key: 'analysis.jev.acronymMinLength', min: JEV_BOUNDS.acronymMinLength.min, max: JEV_BOUNDS.acronymMinLength.max, floor: true },
  { key: 'analysis.jev.contentWordMinLength', min: JEV_BOUNDS.contentWordMinLength.min, max: JEV_BOUNDS.contentWordMinLength.max, floor: true },
];

type NumericJevKey = 'windowWords' | 'windowStrideWords' | 'deltaCdiThreshold' | 'fluffCdiThreshold' | 'minChunkTokens' | 'maxChunkTokens' | 'maxChunks' | 'acronymMinLength' | 'contentWordMinLength';
type BooleanJevKey = 'enabled' | 'countAcronyms' | 'countProperNouns' | 'countNumbers' | 'countContentWords';

function resolveNumber(raw: Record<string, unknown>, configKey: NumericJevKey, spec: NumericSpec): number {
  const value = raw[spec.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return JEV_DEFAULTS[configKey];
  let result = value;
  if (spec.floor) result = Math.floor(result);
  return Math.max(spec.min, Math.min(spec.max, result));
}

function resolveBoolean(raw: Record<string, unknown>, registryKey: string, configKey: BooleanJevKey): boolean {
  const value = raw[registryKey];
  if (typeof value !== 'boolean') return JEV_DEFAULTS[configKey];
  return value;
}

/**
 * Resolve the Jev config from raw registry values (keyed by the full
 * registry key). Missing / wrong-type / non-finite values fall back to
 * `JEV_DEFAULTS`; numbers are clamped to their JEV_BOUNDS range. If
 * `minChunkTokens > maxChunkTokens` after resolution, BOTH fall back to
 * their defaults (a valid [min,max] pair must always result).
 */
export function resolveJevConfig(raw: Record<string, unknown>): JevConfig {
  const config: JevConfig = {
    enabled: resolveBoolean(raw, 'analysis.jev.enabled', 'enabled'),
    windowWords: resolveNumber(raw, 'windowWords', NUMERIC_SPECS[0]!),
    windowStrideWords: resolveNumber(raw, 'windowStrideWords', NUMERIC_SPECS[1]!),
    deltaCdiThreshold: resolveNumber(raw, 'deltaCdiThreshold', NUMERIC_SPECS[2]!),
    fluffCdiThreshold: resolveNumber(raw, 'fluffCdiThreshold', NUMERIC_SPECS[3]!),
    minChunkTokens: resolveNumber(raw, 'minChunkTokens', NUMERIC_SPECS[4]!),
    maxChunkTokens: resolveNumber(raw, 'maxChunkTokens', NUMERIC_SPECS[5]!),
    maxChunks: resolveNumber(raw, 'maxChunks', NUMERIC_SPECS[6]!),
    acronymMinLength: resolveNumber(raw, 'acronymMinLength', NUMERIC_SPECS[7]!),
    contentWordMinLength: resolveNumber(raw, 'contentWordMinLength', NUMERIC_SPECS[8]!),
    countAcronyms: resolveBoolean(raw, 'analysis.jev.countAcronyms', 'countAcronyms'),
    countProperNouns: resolveBoolean(raw, 'analysis.jev.countProperNouns', 'countProperNouns'),
    countNumbers: resolveBoolean(raw, 'analysis.jev.countNumbers', 'countNumbers'),
    countContentWords: resolveBoolean(raw, 'analysis.jev.countContentWords', 'countContentWords'),
  };
  if (config.minChunkTokens > config.maxChunkTokens) {
    config.minChunkTokens = JEV_DEFAULTS.minChunkTokens;
    config.maxChunkTokens = JEV_DEFAULTS.maxChunkTokens;
  }
  return config;
}
