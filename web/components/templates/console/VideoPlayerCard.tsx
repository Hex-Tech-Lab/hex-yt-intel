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
  const { isPlaying, seekTo, clearSeek, setPlaying } = useVideoStore();
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
    if (!mounted || !videoId || !containerRef.current) return;
    
    let cancelled = false;
    
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setReady(false);
    videoIdRef.current = videoId;

    const adapter = new YouTubePlayerAdapter();
    adapter.mount(containerRef.current, videoId, {
      onReady: () => {
        if (cancelled || videoIdRef.current !== videoId) {
          adapter.destroy();
          return;
        }
        playerRef.current = adapter;
        setReady(true);
        if (seekQueueRef.current !== null) {
          adapter.seekTo(seekQueueRef.current);
          seekQueueRef.current = null;
        }
        if (isPlayingRef.current) adapter.play();
      },
      onError: (err) => {
        if (!cancelled) console.error('[VideoPlayerCard]', err.message);
      },
      onPlay: () => {
        if (!cancelled) setPlaying(true);
      },
      onPause: () => {
        if (!cancelled) setPlaying(false);
      },
    });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      videoIdRef.current = null;
      setReady(false);
    };
  }, [mounted, videoId, setPlaying]);

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
