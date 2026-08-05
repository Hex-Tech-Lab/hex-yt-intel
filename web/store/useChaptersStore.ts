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

interface ChaptersStore {
  /** Per-video cache, keyed by videoId. Cache invalidation mechanism:
   *  re-fetch after re-analysis persists (the re-parse + idempotent RPC
   *  write IS the invalidation), not description-diffing — descriptions
   *  essentially never change post-publish, and the re-parse naturally
   *  overwrites stale rows. */
  entries: Record<string, VideoChaptersState>;
  setLoading: (videoId: string) => void;
  setLoaded: (videoId: string, chapters: ChapterEntry[]) => void;
  setError: (videoId: string) => void;
  getChapters: (videoId: string) => VideoChaptersState;
  /** Reset cache for a specific video (e.g. on re-analysis) */
  reset: (videoId: string) => void;
}

export const useChaptersStore = create<ChaptersStore>((set, get) => ({
  entries: {},

  setLoading: (videoId) =>
    set((state) => ({
      entries: { ...state.entries, [videoId]: { status: 'loading', chapters: [], fetchedAt: null } },
    })),

  setLoaded: (videoId, chapters) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [videoId]: { status: 'loaded', chapters, fetchedAt: Date.now() },
      },
    })),

  setError: (videoId) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [videoId]: { status: 'error', chapters: [], fetchedAt: Date.now() },
      },
    })),

  getChapters: (videoId) => {
    const entry = get().entries[videoId];
    return entry ?? { status: 'idle', chapters: [], fetchedAt: null };
  },

  reset: (videoId) =>
    set((state) => {
      const next = { ...state.entries };
      delete next[videoId];
      return { entries: next };
    }),
}));