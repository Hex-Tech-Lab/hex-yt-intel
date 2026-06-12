import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  setPlaying: (isPlaying: boolean) => void;
  jumpToTimestamp: (timestamp: number) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  setPlaying: (isPlaying) => set({ isPlaying }),
  jumpToTimestamp: (timestamp) => set({ seekTo: timestamp }),
}));
