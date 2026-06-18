'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';
import type { VideoPlayerPort } from '@/lib/ports/VideoPlayerPort';

export function VideoPlayerCard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoPlayerPort | null>(null);
  const { isPlaying, seekTo, clearSeek } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const nucleusVideoId = useSynthesisNucleus((s) => s.analysis?.videoId);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  const videoId = videoMetadata?.videoId || nucleusVideoId;

  useEffect(() => {
    setMounted(true);
  }, []);

  const initPlayer = useCallback(async () => {
    if (!containerRef.current || !videoId) return;
    const adapter = new YouTubePlayerAdapter();
    playerRef.current = adapter;
    await adapter.mount(containerRef.current, videoId, {
      onReady: () => setReady(true),
      onError: (err) => console.error('[VideoPlayerCard]', err.message),
    });
  }, [videoId]);

  useEffect(() => {
    if (!mounted || !videoId) return;
    playerRef.current?.destroy();
    setReady(false);
    initPlayer();
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [mounted, videoId, initPlayer]);

  useEffect(() => {
    if (seekTo !== null && ready) {
      playerRef.current?.seekTo(seekTo);
      clearSeek();
    }
  }, [seekTo, ready, clearSeek]);

  useEffect(() => {
    if (!ready) return;
    if (isPlaying) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
  }, [isPlaying, ready]);

  if (!mounted || !videoId) return null;

  return (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
