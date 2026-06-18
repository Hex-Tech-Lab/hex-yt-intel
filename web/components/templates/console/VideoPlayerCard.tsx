'use client';

import { useEffect, useRef, useState } from 'react';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';
import type { VideoPlayerPort } from '@/lib/ports/VideoPlayerPort';

export function VideoPlayerCard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoPlayerPort | null>(null);
  const seekQueueRef = useRef<number | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const { isPlaying, seekTo, clearSeek } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const nucleusVideoId = useSynthesisNucleus((s) => s.analysis?.videoId);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  const videoId = videoMetadata?.videoId || nucleusVideoId;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !videoId) return;
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setReady(false);
    videoIdRef.current = videoId;

    const adapter = new YouTubePlayerAdapter();
    playerRef.current = adapter;
    adapter.mount(containerRef.current!, videoId, {
      onReady: () => {
        if (videoIdRef.current !== videoId) {
          adapter.destroy();
          return;
        }
        setReady(true);
        if (seekQueueRef.current !== null) {
          adapter.seekTo(seekQueueRef.current);
          seekQueueRef.current = null;
        }
        if (isPlayingRef.current) adapter.play();
      },
      onError: (err) => console.error('[VideoPlayerCard]', err.message),
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      videoIdRef.current = null;
      setReady(false);
    };
  }, [mounted, videoId]);

  useEffect(() => {
    if (seekTo === null) return;
    if (ready && playerRef.current) {
      playerRef.current.seekTo(seekTo);
    } else {
      seekQueueRef.current = seekTo;
    }
    clearSeek();
  }, [seekTo, ready, clearSeek]);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    if (isPlaying) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
  }, [isPlaying, ready]);

  if (!mounted || !videoId) return null;

  return (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
