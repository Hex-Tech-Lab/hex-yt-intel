'use client';

import { useVideoStore } from '@/store/useVideoStore';
import { useCallback } from 'react';

export interface TimestampLinkProps {
  timestamp: string; // Format: HH:MM:SS or MM:SS or just seconds
  children?: React.ReactNode;
  className?: string;
}

const parseTimestamp = (timestamp: string): number => {
  const parts = timestamp.split(':').map(p => parseInt(p, 10)).filter(p => !isNaN(p));
  if (parts.length === 0) return 0;

  const multipliers = [3600, 60, 1];
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const multiplier = multipliers[parts.length - i - 1] || 1;
    total += parts[i] * multiplier;
  }
  return total;
};

/**
 * TimestampLink component for clickable timestamps in video content
 * Clicking the timestamp seeks the video player to that position
 */
export function TimestampLink({ timestamp, children, className = '' }: TimestampLinkProps) {
  const { setSeekTo } = useVideoStore();
  const seconds = parseTimestamp(timestamp);

  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (seconds >= 0) {
      setSeekTo(seconds);
    }
  }, [seconds, setSeekTo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (seconds >= 0) {
        setSeekTo(seconds);
      }
    }
  }, [seconds, setSeekTo]);

  return (
    <a
      href={`#${timestamp}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-mono transition-colors hover:bg-accent/20 active:bg-accent/30 cursor-pointer text-accent hover:text-accent-bright focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      title={`Seek to ${timestamp}`}
      role="button"
      tabIndex={0}
      aria-label={`Seek to ${timestamp}`}
    >
      {children || (
        <>
          <span aria-hidden="true">⏱</span>
          <span>{timestamp}</span>
        </>
      )}
    </a>
  );
}
