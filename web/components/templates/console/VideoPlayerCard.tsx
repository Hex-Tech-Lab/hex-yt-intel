'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { setPlayerInstance } from '@/lib/player-manager';

// Dynamically import ReactPlayer to prevent SSR/hydration mismatch issues
const Player = dynamic(() => import('react-player'), { ssr: false }) as any;

export function VideoPlayerCard() {
  const playerRef = useRef<any>(null);
  const { isPlaying, setPlaying, seekTo, clearSeek } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const nucleusVideoId = useSynthesisNucleus((s) => s.analysis?.videoId);
  const [mounted, setMounted] = useState(false);

  const videoId = videoMetadata?.videoId || nucleusVideoId;

  useEffect(() => {
    setMounted(true);
    setPlayerInstance(playerRef.current);
    return () => setPlayerInstance(null);
  }, []);

  useEffect(() => {
    if (!videoMetadata?.videoId && nucleusVideoId) {
      console.warn('[VideoPlayerCard] VideoMetadata missing videoId; falling back to synthesis nucleus videoId:', nucleusVideoId);
    }
  }, [videoMetadata, nucleusVideoId]);

  useEffect(() => {
    if (seekTo !== null && playerRef.current) {
      playerRef.current.seekTo(seekTo, 'seconds');
      clearSeek(); 
    }
  }, [seekTo, clearSeek]);

  if (!mounted || !videoId) return null;

  return (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      <Player
        ref={playerRef}
        url={`https://www.youtube.com/watch?v=${videoId}`}
        config={{
          youtube: {
            embedOptions: {
              host: 'https://www.youtube-nocookie.com',
            },
            playerVars: {
              origin: typeof window !== 'undefined' ? window.location.origin : '',
              modestbranding: 1,
              rel: 0,
            },
          },
        }}
        width="100%"
        height="100%"
        playing={isPlaying}
        controls
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
