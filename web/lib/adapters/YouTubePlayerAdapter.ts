import * as Sentry from '@sentry/nextjs';
import type { VideoPlayerPort, VideoPlayerCallbacks } from '@/lib/ports/VideoPlayerPort';

interface YTPlayerEvent {
  data: number;
}

interface YTPlayerInstance {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
  getCurrentTime(): number;
}

interface YTPlayerConstructor {
  new (
    container: HTMLElement | string,
    config: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onError?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
      };
    },
  ): YTPlayerInstance;
}

interface YTNamespace {
  Player: YTPlayerConstructor;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;
let resolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

function loadYouTubeAPI(): Promise<void> {
  if (typeof window !== 'undefined' && window.YT?.Player) {
    return Promise.resolve();
  }

  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve, reject) => {
    resolvers.push({ resolve, reject });

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existingScript) {
      if (window.YT?.Player) {
        for (const r of resolvers) r.resolve();
        resolvers = [];
        apiLoadPromise = null;
        return;
      }
      const previousExisting = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousExisting === 'function') previousExisting();
        for (const r of resolvers) r.resolve();
        resolvers = [];
        apiLoadPromise = null;
      };
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      for (const r of resolvers) r.resolve();
      resolvers = [];
      apiLoadPromise = null;
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      window.onYouTubeIframeAPIReady = previous;
      for (const r of resolvers) r.reject(new Error('Failed to load YouTube IFrame API'));
      resolvers = [];
      apiLoadPromise = null;
    };
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
  });
  return apiLoadPromise;
}

function getApi(): YTNamespace | undefined {
  return window.YT;
}

export class YouTubePlayerAdapter implements VideoPlayerPort {
  private player: YTPlayerInstance | null = null;
  private destroyed = false;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;

  async mount(container: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void> {
    this.destroyed = false;

    const timeout = new Promise<never>((_, reject) => {
      this.loadTimeout = setTimeout(() => {
        reject(new Error('YouTube Player mount timed out after 30s'));
      }, 30000);
    });

    try {
      await Promise.race([loadYouTubeAPI(), timeout]);
      if (this.loadTimeout) { clearTimeout(this.loadTimeout); this.loadTimeout = null; }

      if (this.destroyed) return;

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
          onError: (e: YTPlayerEvent) => {
            if (!this.destroyed) callbacks?.onError?.(new Error(`YouTube error: ${e.data}`));
          },
          onStateChange: (e: YTPlayerEvent) => {
            if (this.destroyed) return;
            if (e.data === 1) callbacks?.onPlay?.();
            else if (e.data === 2) callbacks?.onPause?.();
          },
        },
      });
    } catch (err) {
      if (this.loadTimeout) { clearTimeout(this.loadTimeout); this.loadTimeout = null; }
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
    if (this.loadTimeout) {
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
    }
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
