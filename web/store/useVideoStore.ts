import { create } from 'zustand';

export interface VideoState {
  isPlaying: boolean;
  seekTo: number | null;
  pendingNav: 'console' | null;
  entityTimeSeekEnabled: boolean;
  /** Current playback position in seconds, updated by VideoPlayerCard's
   *  timeupdate polling. Null when no video has been played yet. */
  currentPlaybackSeconds: number | null;
  /** Playback speed multiplier applied to the mounted YouTube player
   *  (highlights-reel redesign, 2026-08-20). Read by VideoPlayerCard and
   *  applied via YouTubePlayerAdapter.setPlaybackRate whenever it or
   *  `ready` changes -- not just once on mount -- so a speed change made
   *  mid-playback (e.g. from the highlights reel's speed control) takes
   *  effect immediately instead of only on the next player mount. */
  playbackRate: number;
  isTransitioning: boolean;
  setPlaying: (isPlaying: boolean) => void;
  setSeekTo: (seconds: number) => void;
  setCurrentPlaybackSeconds: (seconds: number | null) => void;
  setPlaybackRate: (rate: number) => void;
  setEntityTimeSeekEnabled: (enabled: boolean) => void;
  toggleEntityTimeSeek: () => void;
  clearPendingNav: () => void;
  clearSeek: () => void;
  setTransitioning: (active: boolean) => void;
  reset: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  isPlaying: false,
  seekTo: null,
  pendingNav: null,
  entityTimeSeekEnabled: false,
  currentPlaybackSeconds: null,
  playbackRate: 1,
  isTransitioning: false,
  setPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  setEntityTimeSeekEnabled: (enabled) => set({ entityTimeSeekEnabled: enabled }),
  toggleEntityTimeSeek: () => set((s) => ({ entityTimeSeekEnabled: !s.entityTimeSeekEnabled })),
  // A timestamp click always means "play from here" -- without this, a
  // click before the video's ever been manually started mounts the YouTube
  // player, queues the seek, but never calls play() (VideoPlayerCard's
  // onReady only autoplays when isPlaying was already true), so the iframe
  // loads cued-but-paused and renders as a black frame until the user
  // presses play once. RCA 2026-07-30.
  setSeekTo: (seconds) => set({ seekTo: seconds, pendingNav: 'console', isPlaying: true }),
  setCurrentPlaybackSeconds: (seconds) => set({ currentPlaybackSeconds: seconds }),
  clearPendingNav: () => set({ pendingNav: null }),
  clearSeek: () => set({ seekTo: null }),
  setTransitioning: (active) => set({ isTransitioning: active }),
  reset: () => set({ isPlaying: false, seekTo: null, pendingNav: null, currentPlaybackSeconds: null, playbackRate: 1, isTransitioning: false }),
}));
