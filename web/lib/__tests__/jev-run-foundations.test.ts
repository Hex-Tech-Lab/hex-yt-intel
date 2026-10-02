/** R3b 2.5e foundations: ETA, K>1 run store, progress-only stream adapter. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { estimateRemainingMs, formatEta } from '@/lib/jev/eta';
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
