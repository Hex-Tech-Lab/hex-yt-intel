import { useEffect, useRef } from 'react';
import { useInputStore } from '@/store/useInputStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { extractVideoId } from '@/lib/youtube';

/**
 * Eagerly fetches video metadata when a valid YouTube URL is entered.
 * Populates the analysis store so the video player appears immediately,
 * before the user clicks "Analyze".
 */
export function useEagerVideoMetadata() {
  const url = useInputStore((s) => s.url);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!url) return;

    const videoId = extractVideoId(url);
    if (!videoId || videoId === 'unknown') return;

    // If metadata is already loaded for this video, skip
    const existing = useAnalysisStore.getState().videoMetadata;
    if (existing?.videoId === videoId && existing?.title) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/metadata?videoId=${videoId}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (controller.signal.aborted) return;

        // Only set if no analysis is in progress (avoids overwriting live data)
        const current = useAnalysisStore.getState();
        if (current.status !== 'downloading' && current.status !== 'analyzing') {
          useAnalysisStore.getState().setVideoMetadata({
            videoId: data.videoId,
            title: data.title,
            channelTitle: data.channelTitle,
            channelId: data.channelId,
            publishedAt: data.publishedAt,
            duration: data.duration,
            viewCount: data.viewCount,
            likeCount: data.likeCount,
            commentCount: data.commentCount,
            thumbnailUrl: data.thumbnailUrl,
          });
        }
      } catch {
        // AbortError is expected; other errors are non-fatal
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url]);
}
