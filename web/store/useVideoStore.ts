import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  pendingNav: 'console' | null;
  entityTimeSeekEnabled: boolean;
  setPlaying: (isPlaying: boolean) => void;
  setSeekTo: (seconds: number) => void;
  setEntityTimeSeekEnabled: (enabled: boolean) => void;
  toggleEntityTimeSeek: () => void;
  clearPendingNav: () => void;
  clearSeek: () => void;
  reset: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  pendingNav: null,
  entityTimeSeekEnabled: false,
  setPlaying: (isPlaying) => set({ isPlaying }),
  setEntityTimeSeekEnabled: (enabled) => set({ entityTimeSeekEnabled: enabled }),
  toggleEntityTimeSeek: () => set((s) => ({ entityTimeSeekEnabled: !s.entityTimeSeekEnabled })),
  // A timestamp click always means "play from here" -- without this, a
  // click before the video's ever been manually started mounts the YouTube
  // player, queues the seek, but never calls play() (VideoPlayerCard's
  // onReady only autoplays when isPlaying was already true), so the iframe
  // loads cued-but-paused and renders as a black frame until the user
  // presses play once. RCA 2026-07-30.
  setSeekTo: (seconds) => set({ seekTo: seconds, pendingNav: 'console', isPlaying: true }),
  clearPendingNav: () => set({ pendingNav: null }),
  clearSeek: () => set({ seekTo: null }),
  reset: () => set({ isPlaying: false, seekTo: null, pendingNav: null }),
}));
