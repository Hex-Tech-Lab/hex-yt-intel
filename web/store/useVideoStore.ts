import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  setPlaying: (isPlaying: boolean) => void;
  clearSeek: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  setPlaying: (isPlaying) => set({ isPlaying }),
  clearSeek: () => set({ seekTo: null }),
}));
