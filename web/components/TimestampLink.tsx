'use client';

import { useCallback } from 'react';
import { Link } from '@astryxdesign/core';
import { useVideoStore } from '@/store/useVideoStore';

export interface TimestampLinkProps {
  timestamp: string; // Format: HH:MM:SS or MM:SS or just seconds
  children?: React.ReactNode;
  className?: string;
  /**
   * Render as a semantic `<button type="button">` instead of an `<a>`.
   * Dimension-content timestamps are seek controls, not navigation links;
   * the `href`-bearing `<a>` form is kept for contexts that genuinely need
   * an anchor (default).
   */
  asButton?: boolean;
}

/**
 * Converts timestamp string to total seconds.
 * Supports multiple formats: HH:MM:SS, MM:SS, or raw seconds.
 * @param timestamp - Timestamp string in format "HH:MM:SS", "MM:SS", or raw seconds
 * @returns Total number of seconds
 * @example parseTimestamp("1:30:45") // returns 5445
 * @example parseTimestamp("30:45") // returns 1845
 * @example parseTimestamp("45") // returns 45
 */
export const parseTimestamp = (timestamp: string): number => {
  const rawParts = timestamp.split(':');
  const parts: number[] = [];
  for (const pStr of rawParts) {
    const parsedNum = parseInt(pStr, 10);
    if (!isNaN(parsedNum)) parts.push(parsedNum);
  }
  if (parts.length === 0) return 0;

  const multipliers: number[] = [3600, 60, 1];
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const multiplier = multipliers[multipliers.length - parts.length + i] || 1;
    if (part !== undefined) {
      total += part * multiplier;
    }
  }
  return total;
};

/**
 * Shared global-stylesheet class for seek buttons (styled in
 * `web/app/globals.css`). Layout utilities stay inline; every visual state
 * (hover/active/focus) lives in the single centralized rule so all
 * timestamp buttons across dimension views restyle in one place.
 */
const SEEK_BUTTON_UTILITY_CLASS = 'inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-mono transition-colors cursor-pointer';
const SEEK_BUTTON_CLASS = `hx-timestamp-seek ${SEEK_BUTTON_UTILITY_CLASS}`;

/**
 * TimestampLink component for clickable timestamps in video content
 * Clicking the timestamp seeks the video player to that position
 */
export function TimestampLink({ timestamp, children, className = '', asButton = false }: TimestampLinkProps) {
  // Scoped selector, not `useVideoStore()` (whole-store subscription) --
  // this store now also carries currentPlaybackSeconds, updated 4x/sec
  // while playing (post-review finding, 2026-08-06); a whole-store
  // subscriber here would re-render on every one of those ticks for a
  // component that only ever calls the stable setSeekTo action.
  const setSeekTo = useVideoStore((state) => state.setSeekTo);
  const seconds = parseTimestamp(timestamp);

  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (seconds >= 0) {
      setSeekTo(seconds);
    }
  }, [seconds, setSeekTo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (seconds >= 0) {
        setSeekTo(seconds);
      }
    }
  }, [seconds, setSeekTo]);

  if (asButton) {
    return (
      <button
        type="button"
        className={`${SEEK_BUTTON_CLASS} ${className}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={`Seek to ${timestamp}`}
        data-timestamp={timestamp}
      >
        {children || (
          <>
            <span aria-hidden="true">⏱</span>
            <span>{timestamp}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <Link
      href={`#${timestamp}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      type="inherit"
      color="accent"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-mono transition-colors hover:bg-accent/20 active:bg-accent/30 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] ${className}`}
      tooltip={`Seek to ${timestamp}`}
      label={`Seek to ${timestamp}`}
    >
      {children || (
        <>
          <span aria-hidden="true">⏱</span>
          <span>{timestamp}</span>
        </>
      )}
    </Link>
  );
}
