'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';
import { fmtHighlightsDuration, getClampedSegmentEnd, getHighlightPlaybackDuration, HIGHLIGHTS_REGISTRY_FALLBACK, sumHighlightDurations } from '@/lib/utils/highlights-settings';
import { HighlightsTrack } from '@/components/dashboard/HighlightsTrack';
import { useHighlightTicker, previewWords } from '@/lib/hooks/useHighlightTicker';
import { useSegmentPlayback, SPEED_OPTIONS, type SegmentPlaybackPrimitives } from '@/lib/hooks/useSegmentPlayback';

interface Highlight {
  idx: number;
  start: number;
  end: number;
  label: string;
  takeawayIdx?: number | null;
  verbatimExcerpt?: string | null;
}

/**
 * Read-only, no-signin variant of HighlightsScrubber for the public
 * /share/[token] view (task #11, docs/private/2026-08-13_1539_v2_HIGHLIGHTS_
 * REEL_SHARE_WORKFLOW_SPEC.md), redesigned 2026-08-20 alongside the
 * authenticated version (docs/UI_FEEDBACK_TRIAGE_2026-08-20.md items 6-8).
 * Shares the presentational HighlightsTrack shell AND the segment-advance
 * state machine (useSegmentPlayback, extracted 2026-08-20 -- see
 * docs/agent-prompts/2026-08-20-cc-simplify-shared-playback-hook.md) with
 * HighlightsScrubber.tsx, but supplies its own YouTubePlayerAdapter-backed
 * primitives (no useVideoStore -- anonymous viewers never touch the
 * dashboard's Zustand store), unlike the authed variant.
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

  useEffect(() => {
    const adapter = new YouTubePlayerAdapter();
    playerRef.current = adapter;
    if (containerRef.current) {
      adapter.mount(containerRef.current, videoId, {
        onReady: () => setReady(true),
      });
    }
    return () => {
      adapter.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Adapter-backed primitives. getCurrentTime returns null until the
  // player has actually fired onReady -- this is what lets the shared
  // hook's own readiness guard (finding #3) work here without this
  // component needing to separately gate on a `ready` flag for playback
  // purposes (still used below for the Play button's disabled state,
  // which is a "nothing to show yet" UI concern, not a playback-safety one).
  const primitives: SegmentPlaybackPrimitives = useMemo(
    () => ({
      getCurrentTime: () => (ready ? playerRef.current?.getCurrentTime?.() ?? null : null),
      seekTo: (seconds: number) => playerRef.current?.seekTo(seconds),
      play: () => playerRef.current?.play(),
      setPlaybackRate: (rate: number) => playerRef.current?.setPlaybackRate?.(rate),
    }),
    [ready]
  );

  const minDur = HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'];
  const maxDur = HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'];

  // Clamp each highlight's end to [start+minDur, start+maxDur] before passing to
  // useSegmentPlayback — old DB rows have end_seconds = next highlight's start
  // (could be 120s+), which would produce multi-minute playback segments without this.
  const clampedSegments = useMemo(
    () => highlights.map((highlight) => ({ ...highlight, end: getClampedSegmentEnd(highlight, segmentDurationSeconds, minDur, maxDur) })),
    [highlights, segmentDurationSeconds, minDur, maxDur],
  );

  const { playingIdx, elapsedInSegmentSeconds, speed, start, stop: stopPlayback, jumpTo, setSpeed } = useSegmentPlayback({
    segments: clampedSegments,
    contextLeadSeconds,
    segmentDurationSeconds,
    primitives,
  });

  // The shared hook's stop() only clears its own state (playingIdx/elapsed)
  // -- it has no opinion on pausing a specific player implementation. This
  // variant's primitive source (YouTubePlayerAdapter) needs an explicit
  // pause() call on stop, unlike the store-backed variant where setSeekTo
  // already drives isPlaying through the store.
  const stop = useCallback(() => {
    stopPlayback();
    playerRef.current?.pause();
  }, [stopPlayback]);

  // Real bug fix (automated review, carried over from the pre-extraction
  // version): a speed selected before the player is ready is a silent
  // no-op pre-mount (setPlaybackRate?.() above). Reapply once ready so
  // playback doesn't silently start at 1x despite the UI showing the
  // chosen speed.
  useEffect(() => {
    if (ready) playerRef.current?.setPlaybackRate?.(speed);
  }, [ready, speed]);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  const activeHighlight = playingIdx !== null ? highlights[playingIdx] : null;
  const nextHighlight = playingIdx !== null ? highlights[playingIdx + 1] : null;
  const activeDuration = activeHighlight
    ? getHighlightPlaybackDuration(activeHighlight, segmentDurationSeconds, minDur, maxDur)
    : segmentDurationSeconds;
  const { revealedText } = useHighlightTicker(playingIdx, activeHighlight?.label ?? null, activeDuration, elapsedInSegmentSeconds, activeHighlight?.verbatimExcerpt ?? null);

  if (highlights.length === 0) return null;

  // Sum each highlight's real clamped duration (fallback to
  // segmentDurationSeconds when end is null/invalid), so the display total
  // matches what actually plays (variable-duration advance on segment.end).
  const totalHighlightsSeconds = Math.min(
    sumHighlightDurations(highlights, segmentDurationSeconds, minDur, maxDur),
    videoDurationSeconds ?? Infinity
  );
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.min(100, Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100))
    : null;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-semibold text-gray-900">Highlights Reel</span>
        <span className="text-xs text-gray-500">
          {highlights.length} keypoints · {fmtHighlightsDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtHighlightsDuration(videoDurationSeconds)}` : ''}
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
        segmentDurationSeconds={segmentDurationSeconds}
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
            onChange={(changeEvent) => setSpeed(Number(changeEvent.target.value))}
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
