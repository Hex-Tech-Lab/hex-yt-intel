import { create } from 'zustand';

/**
 * R3b 2.5e: state of an in-flight K>1 (Jev map-reduce) analysis run.
 * `run` is non-null from dispatch until the server's reduced result has been
 * swapped in; the dimension grid keeps its active edge and the detail panel
 * stays locked while it is set. `partialDimensions` (from
 * validation_report.jev_partial_dimensions) outlives the run and drives the
 * "based on part of the video" badge.
 */
export interface JevRunState {
  run: { total: number; settled: number; startedAt: number } | null;
  partialDimensions: number[];
  startRun: (total: number, startedAt: number) => void;
  markCellSettled: () => void;
  finishRun: (partialDimensions: number[]) => void;
  /** Restore paths: the loaded analysis's partial dimensions; never touches an in-flight run. */
  setPartialDimensions: (partialDimensions: number[]) => void;
  clear: () => void;
}

export const useJevRunStore = create<JevRunState>((set) => ({
  run: null,
  partialDimensions: [],
  startRun: (total, startedAt) => set({ run: { total, settled: 0, startedAt }, partialDimensions: [] }),
  markCellSettled: () =>
    set((state) => (state.run ? { run: { ...state.run, settled: Math.min(state.run.total, state.run.settled + 1) } } : {})),
  finishRun: (partialDimensions) => set({ run: null, partialDimensions }),
  setPartialDimensions: (partialDimensions) => set({ partialDimensions }),
  clear: () => set({ run: null, partialDimensions: [] }),
}));
