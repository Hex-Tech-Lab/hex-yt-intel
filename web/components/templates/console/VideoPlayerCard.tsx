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

  const [playbackError, setPlaybackError] = useState<string | null>(null);

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
    setPlaybackError(null);
    videoIdRef.current = videoId;

    const adapter = new YouTubePlayerAdapter();
    
    // Timeout fallback: if onReady never fires, log and don't hang forever
    const readyTimeout = setTimeout(() => {
      if (!cancelled && !playerRef.current) {
        console.warn('[VideoPlayerCard] Player ready timeout - API may have failed to initialize', { videoId });
      }
    }, 15000);
    
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
        if (cancelled) return;
        console.error('[VideoPlayerCard]', { message: err.message, videoId });
        // Error code 150 or 101 indicates embedding is disabled by the owner.
        if (err.message.includes('150') || err.message.includes('101')) {
          setPlaybackError('Embedding disabled by the video owner. Click the link above to watch directly on YouTube.');
        } else {
          setPlaybackError(err.message);
        }
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
      clearTimeout(readyTimeout);
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      videoIdRef.current = null;
      setReady(false);
      setPlaybackError(null);
    };
  }, [mounted, videoId, setPlaying]);

  useEffect(() => {
    if (seekTo === null) return;
    if (ready && playerRef.current) {
      playerRef.current.seekTo(seekTo);
      requestAnimationFrame(() => {
        clearSeek();
      });
    } else {
      seekQueueRef.current = seekTo;
    }
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
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      {playbackError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg)] p-6 text-center text-xs font-mono border border-[var(--line)]">
          <div className="text-[var(--warn)] font-bold mb-3 uppercase tracking-wider">Embedding Restricted By Creator</div>
          <p className="text-[var(--ink-secondary)] max-w-sm mb-2 leading-relaxed">
            Direct video playback is restricted on external domains by the owner&apos;s embed policy.
          </p>
          <p className="text-[var(--ink-muted)] max-w-sm mb-4 leading-relaxed">
            You can still interact with the full 11-dimension analysis, browse the Knowledge Graph, ask follow-up questions in the Chat, and click on any timestamps to seek content once loaded.
          </p>
        </div>
      ) : null}
      <div ref={containerRef} className={`w-full h-full ${playbackError ? 'hidden' : ''}`} />
    </div>
  );
}
