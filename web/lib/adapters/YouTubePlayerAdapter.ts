import type { VideoPlayerPort, VideoPlayerCallbacks } from '@/lib/ports/VideoPlayerPort';

let apiLoadPromise: Promise<void> | null = null;
let previousCallback: (() => void) | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve, reject) => {
    previousCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      (window as any).onYouTubeIframeAPIReady = previousCallback;
      reject(new Error('Failed to load YouTube IFrame API'));
    };
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
  });
  return apiLoadPromise;
}

export class YouTubePlayerAdapter implements VideoPlayerPort {
  private player: any = null;
  private destroyed = false;

  async mount(container: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void> {
    this.destroyed = false;
    try {
      const YT = (window as any).YT;
      if (!YT) await loadYouTubeAPI();
      const YT_API = (window as any).YT;
      if (!YT_API || !YT_API.Player) {
        callbacks?.onError?.(new Error('YouTube API not available'));
        return;
      }
      this.player = new YT_API.Player(container, {
        videoId,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          origin: window.location.origin,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (this.destroyed) { this.destroy(); return; }
            callbacks?.onReady?.();
          },
          onError: (e: any) => {
            if (!this.destroyed) callbacks?.onError?.(new Error(`YouTube error: ${e.data}`));
          },
        },
      });
    } catch (err) {
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  seekTo(seconds: number): void {
    if (this.player && this.player.seekTo && !this.destroyed) {
      this.player.seekTo(seconds, true);
    }
  }

  play(): void {
    if (this.player && this.player.playVideo && !this.destroyed) {
      this.player.playVideo();
    }
  }

  pause(): void {
    if (this.player && this.player.pauseVideo && !this.destroyed) {
      this.player.pauseVideo();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.player && this.player.destroy) {
      try { this.player.destroy(); } catch { /* already destroyed */ }
    }
    this.player = null;
  }

  getCurrentTime(): number {
    if (this.player && this.player.getCurrentTime && !this.destroyed) {
      return this.player.getCurrentTime();
    }
    return 0;
  }
}
