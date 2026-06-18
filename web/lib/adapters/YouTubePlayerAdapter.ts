import type { VideoPlayerPort, VideoPlayerCallbacks } from '@/lib/ports/VideoPlayerPort';

let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve, reject) => {
    const previous = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      (window as any).onYouTubeIframeAPIReady = previous;
      apiLoadPromise = null;
      reject(new Error('Failed to load YouTube IFrame API'));
    };
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
  });
  return apiLoadPromise;
}

function getApi(): any {
  return (window as any).YT;
}

export class YouTubePlayerAdapter implements VideoPlayerPort {
  private player: any = null;
  private destroyed = false;

  async mount(container: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void> {
    this.destroyed = false;
    try {
      if (!getApi()) {
        await loadYouTubeAPI();
      }
      const YT = getApi();
      if (!YT?.Player) {
        callbacks?.onError?.(new Error('YouTube Player API not available'));
        return;
      }
      this.player = new YT.Player(container, {
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
    if (this.player?.seekTo && !this.destroyed) {
      this.player.seekTo(seconds, true);
    }
  }

  play(): void {
    if (this.player?.playVideo && !this.destroyed) {
      this.player.playVideo();
    }
  }

  pause(): void {
    if (this.player?.pauseVideo && !this.destroyed) {
      this.player.pauseVideo();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.player?.destroy) {
      try { this.player.destroy(); } catch { /* already destroyed */ }
    }
    this.player = null;
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }
}
