export interface VideoPlayerCallbacks {
  onReady?: () => void;
  onError?: (error: Error) => void;
  onPlay?: () => void;
  onPause?: () => void;
  /** Fires on the player's native "ended" state -- distinct from onPause.
   *  Without this, code that only listens for onPause (e.g. stopping a
   *  playback-position poll loop keyed on isPlaying) never gets notified
   *  when the video reaches its end while playing, since YouTube's IFrame
   *  API state machine goes PLAYING -> ENDED, not PLAYING -> PAUSED. */
  onEnded?: () => void;
}

export interface VideoPlayerPort {
  mount(element: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void>;
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
  destroy(): void;
  getCurrentTime(): number;
}
