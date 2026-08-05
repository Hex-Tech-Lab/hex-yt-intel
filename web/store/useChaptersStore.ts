import { create } from 'zustand';

export interface ChapterEntry {
  idx: number;
  start_seconds: number;
  end_seconds: number;
  label: string;
}

interface VideoChaptersState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  chapters: ChapterEntry[];
  fetchedAt: number | null;
}

/** Stable module-level idle snapshot -- returned whenever no cache entry
 *  exists, so callers that (mis)use `getChapters` as a selector don't get a
 *  fresh object literal on every call (Cubic review, finding 1). */
const IDLE_ENTRY: VideoChaptersState = { status: 'idle', chapters: [], fetchedAt: null };

interface ChaptersStore {
  /** Per-video cache, keyed by videoId. Cache invalidation mechanism:
   *  re-fetch after re-analysis persists (the re-parse + idempotent RPC
   *  write IS the invalidation), not description-diffing — descriptions
   *  essentially never change post-publish, and the re-parse naturally
   *  overwrites stale rows. */
  entries: Record<string, VideoChaptersState>;
  /** Per-video monotonic generation counter, bumped by `reset()`. Kept
   *  separate from `entries` (which `reset()` deletes) so a fetch started
   *  before `reset()` can still be told, after the fact, that it's stale
   *  (Cubic review, finding 2: reset() doesn't cancel useChapters' in-flight
   *  fetch/retry loop, so without this an old response's setLoaded() could
   *  clobber the reset with stale chapters). */
  generations: Record<string, number>;
  /** Returns the generation this load belongs to -- callers must pass it
   *  back into setLoaded/setError so those can detect a reset() that fired
   *  while the fetch was in flight. */
  setLoading: (videoId: string) => number;
  setLoaded: (videoId: string, chapters: ChapterEntry[], generation: number) => void;
  setError: (videoId: string, generation: number) => void;
  getChapters: (videoId: string) => VideoChaptersState;
  /** Reset cache for a specific video (e.g. on re-analysis) */
  reset: (videoId: string) => void;
}

export const useChaptersStore = create<ChaptersStore>((set, get) => ({
  entries: {},
  generations: {},

  setLoading: (videoId) => {
    const generation = get().generations[videoId] ?? 0;
    set((state) => ({
      entries: { ...state.entries, [videoId]: { status: 'loading', chapters: [], fetchedAt: null } },
    }));
    return generation;
  },

  setLoaded: (videoId, chapters, generation) => {
    if (generation !== (get().generations[videoId] ?? 0)) return; // stale: reset() fired since this fetch started
    set((state) => ({
      entries: {
        ...state.entries,
        [videoId]: { status: 'loaded', chapters, fetchedAt: Date.now() },
      },
    }));
  },

  setError: (videoId, generation) => {
    if (generation !== (get().generations[videoId] ?? 0)) return; // stale: reset() fired since this fetch started
    set((state) => ({
      entries: {
        ...state.entries,
        [videoId]: { status: 'error', chapters: [], fetchedAt: Date.now() },
      },
    }));
  },

  getChapters: (videoId) => {
    const entry = get().entries[videoId];
    return entry ?? IDLE_ENTRY;
  },

  reset: (videoId) =>
    set((state) => {
      const next = { ...state.entries };
      delete next[videoId];
      return {
        entries: next,
        generations: { ...state.generations, [videoId]: (state.generations[videoId] ?? 0) + 1 },
      };
    }),
}));