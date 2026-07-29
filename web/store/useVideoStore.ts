import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  pendingNav: 'console' | null;
  setPlaying: (isPlaying: boolean) => void;
  setSeekTo: (seconds: number) => void;
  clearPendingNav: () => void;
  clearSeek: () => void;
  reset: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  pendingNav: null,
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSeekTo: (seconds) => set({ seekTo: seconds, pendingNav: 'console' }),
  clearPendingNav: () => set({ pendingNav: null }),
  clearSeek: () => set({ seekTo: null }),
  reset: () => set({ isPlaying: false, seekTo: null, pendingNav: null }),
}));
