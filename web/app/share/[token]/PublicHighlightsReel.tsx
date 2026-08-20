'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';
import { HighlightsTrack } from '@/components/dashboard/HighlightsTrack';
import { useHighlightTicker, previewWords } from '@/lib/hooks/useHighlightTicker';

interface Highlight {
  idx: number;
  start: number;
  end: number;
  label: string;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 3] as const;

function fmtDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m${remainderSeconds.toString().padStart(2, '0')}s` : `${remainderSeconds}s`;
}

/**
 * Read-only, no-signin variant of HighlightsScrubber for the public
 * /share/[token] view (task #11, docs/private/2026-08-13_1539_v2_HIGHLIGHTS_
 * REEL_SHARE_WORKFLOW_SPEC.md), redesigned 2026-08-20 alongside the
 * authenticated version (docs/UI_FEEDBACK_TRIAGE_2026-08-20.md items 6-8).
 * Shares the presentational HighlightsTrack shell with HighlightsScrubber.tsx
 * but owns its own seek/playback state via YouTubePlayerAdapter directly
 * (no useVideoStore -- anonymous viewers never touch the dashboard's
 * Zustand store), unlike the authed variant.
 */
export function PublicHighlightsReel({
  videoId,
  highlights,
  segmentDurationSeconds,
  contextLeadSeconds,
  videoDurationSeconds,
}: {
  videoId: string;
  highlights: Highlight[];
  segmentDurationSeconds: number;
  contextLeadSeconds: number;
  videoDurationSeconds: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerAdapter | null>(null);
  const [ready, setReady] = useState(false);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const stopRef = useRef(false);
  // Media-time clamping (2026-08-20, same fix as HighlightsScrubber.tsx --
  // see that file's comment for full rationale). This variant has no shared
  // Zustand store (anonymous viewers), so it runs its own dedicated poller
  // against the adapter's real getCurrentTime() instead of reusing a store
  // value, matching the pattern directly.
  const pendingSeekTargetRef = useRef<number | null>(null);
  const playingIdxRef = useRef<number | null>(null);

  useEffect(() => {
    playingIdxRef.current = playingIdx;
  }, [playingIdx]);

  useEffect(() => {
    const adapter = new YouTubePlayerAdapter();
    playerRef.current = adapter;
    if (containerRef.current) {
      adapter.mount(containerRef.current, videoId, {
        onReady: () => setReady(true),
      });
    }
    return () => {
      stopRef.current = true;
      adapter.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const stop = useCallback(() => {
    stopRef.current = true;
    pendingSeekTargetRef.current = null;
    setPlayingIdx(null);
    playerRef.current?.pause();
  }, []);

  const playFrom = useCallback(
    (index: number) => {
      if (index >= highlights.length) {
        setPlayingIdx(null);
        pendingSeekTargetRef.current = null;
        return;
      }
      const highlight = highlights[index]!;
      const leadIn = Math.max(0, highlight.start - contextLeadSeconds);
      pendingSeekTargetRef.current = leadIn;
      playerRef.current?.seekTo(leadIn);
      playerRef.current?.play();
      setPlayingIdx(index);
    },
    [highlights, contextLeadSeconds]
  );

  // Dedicated 250ms media-time poll (matches this project's existing
  // VideoPlayerCard.POLL_INTERVAL_MS cadence). Advances once the real
  // player clock crosses this segment's end, immune to buffering stalls and
  // speed changes -- neither of which a wall-clock timer could track.
  useEffect(() => {
    if (!ready) return;
    const intervalId = setInterval(() => {
      if (stopRef.current) return;
      const idx = playingIdxRef.current;
      if (idx === null) return;
      const highlight = highlights[idx];
      if (!highlight) return;
      const currentTime = playerRef.current?.getCurrentTime?.() ?? null;
      if (currentTime === null) return;

      const pendingTarget = pendingSeekTargetRef.current;
      if (pendingTarget !== null) {
        if (Math.abs(currentTime - pendingTarget) <= 1) {
          pendingSeekTargetRef.current = null;
        }
        return;
      }

      const leadIn = Math.max(0, highlight.start - contextLeadSeconds);
      const segmentEnd = leadIn + segmentDurationSeconds;
      if (currentTime >= segmentEnd - 0.3) {
        playFrom(idx + 1);
      }
    }, 250);
    return () => clearInterval(intervalId);
  }, [ready, highlights, contextLeadSeconds, segmentDurationSeconds, playFrom]);

  const start = useCallback(() => {
    stopRef.current = false;
    playFrom(0);
  }, [playFrom]);

  const jumpTo = useCallback(
    (index: number) => {
      stopRef.current = false;
      playFrom(index);
    },
    [playFrom]
  );

  const handleSpeedChange = useCallback((rate: number) => {
    setSpeed(rate);
    playerRef.current?.setPlaybackRate?.(rate);
  }, []);

  // Real bug fix (automated review): a speed selected before the player is
  // ready (`playerRef.current?.setPlaybackRate?.(rate)` above is a silent
  // no-op pre-mount) was never reapplied once the player became ready --
  // playback would start at 1x despite the UI showing the chosen speed.
  // VideoPlayerCard (the authenticated dashboard variant) already reapplies
  // on a [ready, speed] effect; this public variant was missing it.
  useEffect(() => {
    if (ready) playerRef.current?.setPlaybackRate?.(speed);
  }, [ready, speed]);

  const activeHighlight = playingIdx !== null ? highlights[playingIdx] : null;
  const nextHighlight = playingIdx !== null ? highlights[playingIdx + 1] : null;
  const { revealedText } = useHighlightTicker(playingIdx, activeHighlight?.label ?? null, segmentDurationSeconds);

  if (highlights.length === 0) return null;

  // Display total: see HighlightsScrubber.tsx's identical comment -- sum of
  // each highlight's own span, not count * fixed segment duration, now that
  // selection is uncapped.
  const totalHighlightsSeconds = Math.min(
    highlights.reduce((sum, highlight) => sum + Math.max(0, highlight.end - highlight.start), 0) || highlights.length * segmentDurationSeconds,
    videoDurationSeconds ?? Infinity
  );
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.min(100, Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100))
    : null;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-semibold text-gray-900">Highlights reel</span>
        <span className="text-xs text-gray-500">
          {highlights.length} keypoints · {fmtDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtDuration(videoDurationSeconds)}` : ''}
          {compressionPct !== null ? ` (${compressionPct}%)` : ''}
        </span>
      </div>

      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
        <div ref={containerRef} className="w-full h-full" />
      </div>

      <HighlightsTrack
        highlights={highlights}
        activeIndex={playingIdx}
        onSelect={jumpTo}
        videoDurationSeconds={videoDurationSeconds}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {playingIdx === null ? (
          <Button label="Play highlights" variant="primary" size="sm" onClick={start} isDisabled={!ready} />
        ) : (
          <Button label="Stop" variant="ghost" size="sm" onClick={stop} />
        )}

        <label className="flex items-center gap-1 text-[10px] text-gray-500">
          Speed
          <select
            value={speed}
            onChange={(changeEvent) => handleSpeedChange(Number(changeEvent.target.value))}
            aria-label="Playback speed"
            className="text-[10px] rounded border border-gray-300 bg-white px-1 py-0.5"
          >
            {SPEED_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeHighlight && (
        <div className="text-xs text-gray-700 leading-snug" aria-live="polite">
          <span className="font-mono text-[10px] text-gray-400 mr-1">
            {playingIdx! + 1}/{highlights.length}
          </span>
          {revealedText || activeHighlight.label}
        </div>
      )}
      {nextHighlight && (
        <div className="text-[10px] text-gray-400 italic truncate">Up next: {previewWords(nextHighlight.label)}</div>
      )}
    </div>
  );
}
