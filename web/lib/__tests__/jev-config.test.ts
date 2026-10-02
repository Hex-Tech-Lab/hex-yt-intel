import { describe, expect, it } from 'vitest';
import { JEV_BOUNDS, JEV_DEFAULTS, resolveJevConfig } from '@/lib/config/jev';

describe('resolveJevConfig', () => {
  it('returns defaults for empty raw', () => {
    expect(resolveJevConfig({})).toEqual(JEV_DEFAULTS);
  });

  it('returns defaults for non-finite and wrong-type values', () => {
    expect(
      resolveJevConfig({
        'analysis.jev.windowWords': Number.NaN,
        'analysis.jev.windowStrideWords': 'not-a-number',
        'analysis.jev.deltaCdiThreshold': null,
        'analysis.jev.minChunkTokens': Number.POSITIVE_INFINITY,
        'analysis.jev.enabled': 'yes',
        'analysis.jev.countAcronyms': 1,
      })
    ).toEqual(JEV_DEFAULTS);
  });

  it('clamps above max and below min', () => {
    const config = resolveJevConfig({
      'analysis.jev.windowWords': 5000,
      'analysis.jev.windowStrideWords': 1,
      'analysis.jev.deltaCdiThreshold': 2,
      'analysis.jev.fluffCdiThreshold': -1,
      'analysis.jev.minChunkTokens': 99,
      'analysis.jev.maxChunkTokens': 200000,
      'analysis.jev.maxChunks': 100,
      'analysis.jev.acronymMinLength': 1,
      'analysis.jev.contentWordMinLength': 50,
    });
    expect(config.windowWords).toBe(JEV_BOUNDS.windowWords.max);
    expect(config.windowStrideWords).toBe(JEV_BOUNDS.windowStrideWords.min);
    expect(config.deltaCdiThreshold).toBe(JEV_BOUNDS.deltaCdiThreshold.max);
    expect(config.fluffCdiThreshold).toBe(JEV_BOUNDS.fluffCdiThreshold.min);
    expect(config.minChunkTokens).toBe(JEV_BOUNDS.minChunkTokens.min);
    expect(config.maxChunkTokens).toBe(JEV_BOUNDS.maxChunkTokens.max);
    expect(config.maxChunks).toBe(JEV_BOUNDS.maxChunks.max);
    expect(config.acronymMinLength).toBe(JEV_BOUNDS.acronymMinLength.min);
    expect(config.contentWordMinLength).toBe(JEV_BOUNDS.contentWordMinLength.max);
  });

  it('falls back both chunk bounds to defaults when min > max', () => {
    const config = resolveJevConfig({
      'analysis.jev.minChunkTokens': 7000,
      'analysis.jev.maxChunkTokens': 3000,
    });
    expect(config.minChunkTokens).toBe(JEV_DEFAULTS.minChunkTokens);
    expect(config.maxChunkTokens).toBe(JEV_DEFAULTS.maxChunkTokens);
  });

  it('keeps a valid reordered pair', () => {
    const config = resolveJevConfig({
      'analysis.jev.minChunkTokens': 500,
      'analysis.jev.maxChunkTokens': 900,
    });
    expect(config.minChunkTokens).toBe(500);
    expect(config.maxChunkTokens).toBe(900);
  });

  it('floors integer tunables', () => {
    const config = resolveJevConfig({
      'analysis.jev.windowWords': 100.9,
      'analysis.jev.windowStrideWords': 50.5,
      'analysis.jev.minChunkTokens': 1499.9,
      'analysis.jev.maxChunkTokens': 6000.7,
      'analysis.jev.maxChunks': 7.9,
      'analysis.jev.acronymMinLength': 2.9,
      'analysis.jev.contentWordMinLength': 4.9,
    });
    expect(config.windowWords).toBe(100);
    expect(config.windowStrideWords).toBe(50);
    expect(config.minChunkTokens).toBe(1499);
    expect(config.maxChunkTokens).toBe(6000);
    expect(config.maxChunks).toBe(7);
    expect(config.acronymMinLength).toBe(2);
    expect(config.contentWordMinLength).toBe(4);
  });

  it('does not floor fractional non-integer tunables', () => {
    const config = resolveJevConfig({
      'analysis.jev.deltaCdiThreshold': 0.123,
      'analysis.jev.fluffCdiThreshold': 0.045,
    });
    expect(config.deltaCdiThreshold).toBe(0.123);
    expect(config.fluffCdiThreshold).toBe(0.045);
  });

  it('accepts boolean values when correctly typed', () => {
    const config = resolveJevConfig({
      'analysis.jev.enabled': true,
      'analysis.jev.countAcronyms': false,
      'analysis.jev.countProperNouns': false,
      'analysis.jev.countNumbers': false,
      'analysis.jev.countContentWords': false,
    });
    expect(config.enabled).toBe(true);
    expect(config.countAcronyms).toBe(false);
    expect(config.countProperNouns).toBe(false);
    expect(config.countNumbers).toBe(false);
    expect(config.countContentWords).toBe(false);
  });
});

describe('maxChunks clamp (R3b 2.5 audit)', () => {
  it('caps K at 16 so K x 4 grounded bundles fits one /stream-tokens request (64 cells)', () => {
    expect(JEV_BOUNDS.maxChunks.max).toBe(16);
    expect(resolveJevConfig({ 'analysis.jev.maxChunks': 32 }).maxChunks).toBe(16);
  });
});
