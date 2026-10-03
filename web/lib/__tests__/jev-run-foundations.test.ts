/** R3b 2.5e foundations: ETA, K>1 run store, progress-only stream adapter. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { estimateRemainingMs, formatEta, smoothEta } from '@/lib/jev/eta';
import { useJevRunStore } from '@/store/useJevRunStore';
import { SynthesisStreamAdapter } from '@/lib/adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

describe('estimateRemainingMs / formatEta', () => {
  it('null before any cell settles and once all have settled', () => {
    expect(estimateRemainingMs({ total: 9, settled: 0, startedAt: 0 }, 5000)).toBeNull();
    expect(estimateRemainingMs({ total: 9, settled: 9, startedAt: 0 }, 5000)).toBeNull();
  });

  it('extrapolates from the average time per settled cell', () => {
    // 3 cells in 30 s -> 10 s/cell, 6 left -> 60 s
    expect(estimateRemainingMs({ total: 9, settled: 3, startedAt: 0 }, 30_000)).toBe(60_000);
  });

  it('formats seconds and minutes', () => {
    expect(formatEta(null)).toBe('Estimating…');
    expect(formatEta(14_000)).toBe('ETA: 14s');
    expect(formatEta(125_000)).toBe('ETA: 2m 05s');
  });

  it('first call returns raw', () => {
    expect(smoothEta(null, null, 1000)).toBeNull();
    expect(smoothEta(null, 60_000, 1000)).toEqual({ remainingMs: 60_000, at: 1000 });
  });

  it('raw null after a value -> counts down by elapsed', () => {
    const s1 = smoothEta(null, 60_000, 1000);
    expect(s1).toEqual({ remainingMs: 60_000, at: 1000 });
    const s2 = smoothEta(s1, null, 2000);
    expect(s2).toEqual({ remainingMs: 59_000, at: 2000 });
    const s3 = smoothEta(s2, null, 3500);
    expect(s3).toEqual({ remainingMs: 57_500, at: 3500 });
  });

  it('blends below the cutoff and bypasses at its boundary', () => {
    const previous = { remainingMs: 20_000, at: 1_000 };
    expect(smoothEta(previous, 29_999, 1_000)).toEqual({ remainingMs: 22_000, at: 1_000 });
    expect(smoothEta(previous, 30_000, 1_000)).toEqual({ remainingMs: 30_000, at: 1_000 });
  });

  it('bypasses smoothing for a qualifying large change', () => {
    const previous = smoothEta(null, 60_000, 1_000);
    expect(smoothEta(previous, 120_000, 2_000)).toEqual({ remainingMs: 120_000, at: 2_000 });
  });

  it('uses a fresh estimate directly after the countdown reaches zero', () => {
    const initial = smoothEta(null, 1_000, 1_000);
    const expired = smoothEta(initial, null, 2_000);
    expect(expired).toEqual({ remainingMs: 0, at: 2_000 });
    expect(smoothEta(expired, 5_000, 2_000)).toEqual({ remainingMs: 5_000, at: 2_000 });
  });

  it('backward clock (now < prev.at) never increases the ETA', () => {
    const previous = { remainingMs: 20_000, at: 5_000 };
    const steppedBack = smoothEta(previous, null, 3_000);
    expect(steppedBack).toEqual({ remainingMs: 20_000, at: 3_000 });
  });

  it('countdown never goes below 0', () => {
    const s1 = smoothEta(null, 5_000, 1000);
    const s2 = smoothEta(s1, null, 10_000); // 9s elapsed, initial was 5s
    expect(s2).toEqual({ remainingMs: 0, at: 10_000 });
  });

  it('alpha 0 / NaN treated as 0.2', () => {
    const s1 = smoothEta(null, 20_000, 1000);
    const sAlpha0 = smoothEta(s1, 25_000, 1000, 0);
    expect(sAlpha0).toEqual({ remainingMs: 21_000, at: 1000 });
    const sAlphaNaN = smoothEta(s1, 25_000, 1000, Number.NaN);
    expect(sAlphaNaN).toEqual({ remainingMs: 21_000, at: 1000 });
    const sAlphaNeg = smoothEta(s1, 25_000, 1000, -0.5);
    expect(sAlphaNeg).toEqual({ remainingMs: 21_000, at: 1000 });
  });
});

describe('useJevRunStore', () => {
  beforeEach(() => useJevRunStore.getState().clear());

  it('tracks a run from start to finish and keeps partial dimensions after it', () => {
    const store = useJevRunStore.getState();
    store.startRun(3, 100);
    store.markCellSettled();
    store.markCellSettled();
    store.markCellSettled();
    store.markCellSettled(); // never exceeds total
    expect(useJevRunStore.getState().run).toEqual({ total: 3, settled: 3, startedAt: 100 });
    store.finishRun([4, 5]);
    expect(useJevRunStore.getState()).toMatchObject({ run: null, partialDimensions: [4, 5] });
  });
});

describe('SynthesisStreamAdapter progressOnly', () => {
  beforeEach(() => useSynthesisNucleus.getState().reset());

  it('reports completion but writes nothing to the stores', () => {
    const addDimension = vi.spyOn(useSynthesisNucleus.getState(), 'addDimension');
    const onComplete = vi.fn();
    const adapter = new SynthesisStreamAdapter({ progressOnly: true, onComplete });
    adapter.processLine(JSON.stringify({ type: 'dimension', dimension: 1, name: 'D1', content: 'chunk 1 text' }));
    adapter.processLine(JSON.stringify({ type: 'complete', model: 'm', valid: true, videoId: 'v', analysisId: 'a' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(addDimension).not.toHaveBeenCalled();
    addDimension.mockRestore();
  });

  it('reports errors', () => {
    const onError = vi.fn();
    new SynthesisStreamAdapter({ progressOnly: true, onError }).processLine(JSON.stringify({ type: 'error', error: 'boom' }));
    expect(onError).toHaveBeenCalledWith('boom', undefined);
  });
});

describe('restore paths carry the partial badge (R3b 2.5e)', () => {
  beforeEach(() => {
    useSynthesisNucleus.getState().reset();
    useJevRunStore.getState().clear();
  });

  it('loads jev_partial_dimensions from the restored analysis and clears it on switch, never touching a live run', () => {
    const init = useSynthesisNucleus.getState().initializeAnalysis;
    init({ id: 'a-1', validation: { jev_partial_dimensions: [3, 7] } } as never);
    expect(useJevRunStore.getState().partialDimensions).toEqual([3, 7]);

    useJevRunStore.getState().startRun(9, 0);
    init({ id: 'a-2' } as never);
    expect(useJevRunStore.getState().partialDimensions).toEqual([]);
    expect(useJevRunStore.getState().run).toEqual({ total: 9, settled: 0, startedAt: 0 });
  });
});
