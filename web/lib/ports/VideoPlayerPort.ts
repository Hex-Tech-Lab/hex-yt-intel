export interface VideoPlayerCallbacks {
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export interface VideoPlayerPort {
  mount(element: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void>;
  seekTo(seconds: number): void;
  play(): void;
  pause(): void;
  destroy(): void;
  getCurrentTime(): number;
}
