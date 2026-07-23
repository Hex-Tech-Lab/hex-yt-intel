import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  setPlaying: (isPlaying: boolean) => void;
  setSeekTo: (seconds: number) => void;
  clearSeek: () => void;
  reset: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSeekTo: (seconds) => set({ seekTo: seconds }),
  clearSeek: () => set({ seekTo: null }),
  reset: () => set({ isPlaying: false, seekTo: null }),
}));
