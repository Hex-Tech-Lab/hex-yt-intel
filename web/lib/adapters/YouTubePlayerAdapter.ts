import type { VideoPlayerPort, VideoPlayerCallbacks } from '@/lib/ports/VideoPlayerPort';

let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
    (window as any).onYouTubeIframeAPIReady = resolve;
  });
  return apiLoadPromise;
}

export class YouTubePlayerAdapter implements VideoPlayerPort {
  private player: any = null;

  async mount(element: HTMLElement, videoId: string, callbacks?: VideoPlayerCallbacks): Promise<void> {
    await loadYouTubeAPI();
    const YT = (window as any).YT;
    this.player = new YT.Player(element, {
      videoId,
      playerVars: {
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin,
        playsinline: 1,
      },
      events: {
        onReady: () => callbacks?.onReady?.(),
        onError: (e: any) => callbacks?.onError?.(new Error(`YouTube error: ${e.data}`)),
      },
    });
  }

  seekTo(seconds: number): void {
    if (this.player && this.player.seekTo) {
      this.player.seekTo(seconds, true);
    }
  }

  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  destroy(): void {
    this.player?.destroy();
    this.player = null;
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
}
