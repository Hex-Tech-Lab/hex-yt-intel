'use client';

import { useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';

const Player = ReactPlayer as any;

export function VideoPlayerCard({ onClose }: { onClose: () => void }) {
  const playerRef = useRef<any>(null);
  const { seekTo, jumpToTimestamp } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);

  useEffect(() => {
    if (seekTo !== null && playerRef.current) {
      playerRef.current.seekTo(seekTo, 'seconds');
      // Reset seekTo after handling
      jumpToTimestamp(0); 
    }
  }, [seekTo, jumpToTimestamp]);

  if (!videoMetadata) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute inset-x-10 inset-y-20 z-50 bg-[var(--surface)] border border-[var(--line)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex justify-between items-center p-4 border-b border-[var(--line)]">
          <h3 className="font-bold text-[var(--ink)]">{videoMetadata.title}</h3>
          <button onClick={onClose} className="text-[var(--ink-muted)] hover:text-[var(--accent)]">
            Close
          </button>
        </div>
        <div className="flex-1 w-full h-full p-4">
          <div className="aspect-video w-full h-full bg-black rounded-lg overflow-hidden">
            <Player
              ref={playerRef}
              url={`https://www.youtube.com/watch?v=${videoMetadata.videoId}`}
              width="100%"
              height="100%"
              controls
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
