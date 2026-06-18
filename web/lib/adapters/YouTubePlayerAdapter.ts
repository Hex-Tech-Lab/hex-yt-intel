import * as Sentry from '@sentry/nextjs';
import type { VideoPlayerPort, VideoPlayerCallbacks } from '@/lib/ports/VideoPlayerPort';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;
let resolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

function loadYouTubeAPI(): Promise<void> {
  // If already loaded, return immediately
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve();
  }
  
  // If loading in progress, queue this caller
  if (apiLoadPromise) return apiLoadPromise;
  
  apiLoadPromise = new Promise((resolve, reject) => {
    resolvers.push({ resolve, reject });
    
    // Only set up the script once
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      return;
    }
    
    const previous = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      // Resolve all queued callers
      for (const r of resolvers) r.resolve();
      resolvers = [];
      apiLoadPromise = null;
    };
    
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      (window as any).onYouTubeIframeAPIReady = previous;
      // Reject all queued callers
      for (const r of resolvers) r.reject(new Error('Failed to load YouTube IFrame API'));
      resolvers = [];
      apiLoadPromise = null;
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
      await loadYouTubeAPI();
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
          onStateChange: (e: any) => {
            if (this.destroyed) return;
            // YT.PlayerState.PLAYING = 1, PAUSED = 2
            if (e.data === 1) callbacks?.onPlay?.();
            else if (e.data === 2) callbacks?.onPause?.();
          },
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.captureException(error, { tags: { operation: 'youtube-player-mount' }, extra: { videoId } });
      console.error('[YouTubePlayerAdapter]', { message: error.message, videoId });
      callbacks?.onError?.(error);
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
      try { this.player.destroy(); } catch (err) {
        Sentry.captureException(err, { tags: { operation: 'youtube-player-destroy' } });
      }
    }
    this.player = null;
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }
}
