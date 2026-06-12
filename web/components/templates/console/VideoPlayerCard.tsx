'use client';

import { useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';

const Player = ReactPlayer as any;

export function VideoPlayerCard() {
  const playerRef = useRef<any>(null);
  const { seekTo, jumpToTimestamp } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);

  useEffect(() => {
    if (seekTo !== null && playerRef.current) {
      playerRef.current.seekTo(seekTo, 'seconds');
      jumpToTimestamp(0); 
    }
  }, [seekTo, jumpToTimestamp]);

  if (!videoMetadata) return null;

  return (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      <Player
        ref={playerRef}
        url={`https://www.youtube.com/watch?v=${videoMetadata.videoId}`}
        width="100%"
        height="100%"
        controls
      />
    </div>
  );
}
