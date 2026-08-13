'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';

interface Highlight {
  idx: number;
  start: number;
  end: number;
  label: string;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`;
}

/**
 * Read-only, no-signin variant of HighlightsScrubber for the public
 * /share/[token] view (task #11, docs/private/2026-08-13_1539_v2_HIGHLIGHTS_
 * REEL_SHARE_WORKFLOW_SPEC.md). Unlike the authenticated dashboard version,
 * this component receives its data as server-fetched props (no call to the
 * owner-scoped /api/analyses/highlights route, which anon can't pass RLS
 * for) and mounts its own YouTube player instance directly via
 * YouTubePlayerAdapter instead of the authed useVideoStore seek bus, since
 * anonymous viewers never touch the dashboard's Zustand store.
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);

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
      if (timerRef.current) clearTimeout(timerRef.current);
      adapter.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const stop = useCallback(() => {
    stopRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setPlayingIdx(null);
    playerRef.current?.pause();
  }, []);

  const playFrom = useCallback(
    (index: number) => {
      if (index >= highlights.length) {
        setPlayingIdx(null);
        return;
      }
      const highlight = highlights[index]!;
      const leadIn = Math.max(0, highlight.start - contextLeadSeconds);
      playerRef.current?.seekTo(leadIn);
      playerRef.current?.play();
      setPlayingIdx(index);
      timerRef.current = setTimeout(() => {
        if (!stopRef.current) playFrom(index + 1);
      }, segmentDurationSeconds * 1000);
    },
    [highlights, contextLeadSeconds, segmentDurationSeconds]
  );

  const start = useCallback(() => {
    stopRef.current = false;
    playFrom(0);
  }, [playFrom]);

  if (highlights.length === 0) return null;

  const totalHighlightsSeconds = highlights.length * segmentDurationSeconds;
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100)
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

      {playingIdx === null ? (
        <Button label="Play highlights" variant="primary" size="sm" onClick={start} isDisabled={!ready} />
      ) : (
        <div className="flex items-center gap-2">
          <Button label="Stop" variant="ghost" size="sm" onClick={stop} />
          <span className="text-xs text-gray-600">
            {playingIdx + 1} / {highlights.length} — {highlights[playingIdx]!.label}
          </span>
        </div>
      )}
    </div>
  );
}
