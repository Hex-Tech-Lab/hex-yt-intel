'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Spinner } from '@astryxdesign/core';
import { useVideoStore } from '@/store/useVideoStore';
import { HighlightsTrack } from '@/components/dashboard/HighlightsTrack';
import { useHighlightTicker, previewWords } from '@/lib/hooks/useHighlightTicker';

interface Highlight {
  idx: number;
  start: number;
  end: number;
  label: string;
}

interface HighlightsResponse {
  highlights: Highlight[];
  segmentDurationSeconds: number;
  contextLeadSeconds: number;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 3] as const;

function fmtDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m${remainderSeconds.toString().padStart(2, '0')}s` : `${remainderSeconds}s`;
}

/**
 * Marker-track highlights reel (2026-08-20 redesign, live user report --
 * docs/UI_FEEDBACK_TRIAGE_2026-08-20.md items 6-8, replacing the prior
 * Play/Stop-button-only version). Visual shell adapted from
 * EntityMentionTimeline.tsx via the shared HighlightsTrack component --
 * seek logic here is entirely its own, driven only by analysis_highlights
 * timestamps (`/api/analyses/highlights`) via `useVideoStore.setSeekTo`,
 * per the dispatch's CRITICAL CORRECTION. Never imports or models itself on
 * entity-time-seek.ts / RankedEntityMention.
 *
 * Each segment starts contextLeadSeconds before its timestamp so playback
 * doesn't open mid-sentence, plays for segmentDurationSeconds (both
 * Settings Registry values), then advances. Selection itself (how many
 * highlights exist) is uncapped server-side -- see
 * GenerateExecutiveDigestUseCase.extractHighlights /
 * highlights.maxCount -- this component just renders however many come
 * back.
 */
export function HighlightsScrubber({ analysisId, videoDurationSeconds }: { analysisId: string; videoDurationSeconds: number | null }) {
  const [data, setData] = useState<HighlightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  // Real bug class fix (2026-08-20, live report + external research corroboration
  // on the exact same wall-clock-vs-media-time failure mode): segment advance
  // was a setTimeout keyed off segmentDurationSeconds -- immune to neither
  // buffering stalls (timer keeps ticking while the player is frozen
  // mid-seek/rebuffer) nor speed changes mid-segment (only fixed at the moment
  // playFrom fires). Replaced with a media-time watcher against the shared
  // useVideoStore.currentPlaybackSeconds (already polled by VideoPlayerCard at
  // 250ms for EntityMentionTimeline's own auto-advance -- same established
  // pattern, reused here rather than adding a second independent poller).
  const setSeekTo = useVideoStore((state) => state.setSeekTo);
  const setPlaybackRate = useVideoStore((state) => state.setPlaybackRate);
  const currentPlaybackSeconds = useVideoStore((state) => state.currentPlaybackSeconds);
  const stopRef = useRef(false);
  // Seek-settlement guard (mirrors EntityMentionTimeline.tsx's issueSeek/
  // pendingSeekSeconds pattern): a just-issued seek doesn't land in
  // currentPlaybackSeconds for a poll tick or two -- without this guard the
  // stale pre-seek time could still read as "past the new segment's end" and
  // trigger an immediate double-advance.
  const [pendingSeekTarget, setPendingSeekTarget] = useState<number | null>(null);

  const stop = useCallback(() => {
    stopRef.current = true;
    setPendingSeekTarget(null);
    setPlayingIdx(null);
  }, []);

  useEffect(() => stop, [stop]); // unmount cleanup

  useEffect(() => {
    // Stop any in-progress playback from the previous analysisId -- otherwise
    // switching videos mid-playback keeps auto-seeking a now-different
    // player against stale timestamps from the old video's highlights.
    stop();

    // AbortController: if analysisId changes again (or the component
    // unmounts) while this fetch is in flight, cancel the actual request --
    // not just an ignore-flag -- so an older response can never clobber
    // `data` with the wrong analysis's highlights, and the browser doesn't
    // keep a now-pointless request alive.
    const controller = new AbortController();

    async function loadHighlights() {
      setData(null);
      setError(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/analyses/highlights?analysisId=${analysisId}`, { signal: controller.signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        const json: HighlightsResponse = await res.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.debug(`[HighlightsScrubber] fetch aborted for ${analysisId} (analysisId changed or unmounted)`);
          return;
        }
        console.warn(`[HighlightsScrubber] failed to load highlights for ${analysisId}:`, err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    loadHighlights();

    return () => {
      controller.abort();
    };
  }, [analysisId, stop]);

  const playFrom = useCallback(
    (index: number) => {
      if (!data || index >= data.highlights.length) {
        setPlayingIdx(null);
        setPendingSeekTarget(null);
        return;
      }
      const highlight = data.highlights[index]!;
      const leadIn = Math.max(0, highlight.start - data.contextLeadSeconds);
      setSeekTo(leadIn);
      setPendingSeekTarget(leadIn);
      setPlayingIdx(index);
    },
    [data, setSeekTo]
  );

  // Media-time clamping: advance once the shared playback-position store
  // (polled from the real player, not a timer) crosses this segment's end.
  // 0.3s lead buffer accounts for the store's 250ms poll cadence (tighter
  // than the naive fixed-duration timeout, and immune to buffering stalls
  // and speed changes since it reads the actual media clock every tick).
  useEffect(() => {
    if (playingIdx === null || !data || currentPlaybackSeconds === null || stopRef.current) return;
    const highlight = data.highlights[playingIdx];
    if (!highlight) return;
    const leadIn = Math.max(0, highlight.start - data.contextLeadSeconds);
    const segmentEnd = leadIn + data.segmentDurationSeconds;

    if (pendingSeekTarget !== null) {
      if (Math.abs(currentPlaybackSeconds - pendingSeekTarget) <= 1) {
        setPendingSeekTarget(null);
      }
      return;
    }

    if (currentPlaybackSeconds >= segmentEnd - 0.3) {
      playFrom(playingIdx + 1);
    }
  }, [currentPlaybackSeconds, playingIdx, data, pendingSeekTarget, playFrom]);

  const start = useCallback(() => {
    stopRef.current = false;
    playFrom(0);
  }, [playFrom]);

  // Prev/Next navigation jumps directly rather than replaying the sequence
  // from index 0.
  const jumpTo = useCallback(
    (index: number) => {
      stopRef.current = false;
      playFrom(index);
    },
    [playFrom]
  );

  const handleSpeedChange = useCallback(
    (rate: number) => {
      setSpeed(rate);
      setPlaybackRate(rate);
    },
    [setPlaybackRate]
  );

  const activeHighlight = data && playingIdx !== null ? data.highlights[playingIdx] : null;
  const nextHighlight = data && playingIdx !== null ? data.highlights[playingIdx + 1] : null;
  const { revealedText } = useHighlightTicker(playingIdx, activeHighlight?.label ?? null, data?.segmentDurationSeconds ?? 10);

  if (error) return null; // No highlights available (analysis predates the feature, or extraction failed) -- fail quiet, not a broken UI.
  if (loading || !data) return <Spinner size="sm" />;
  if (data.highlights.length === 0) return null;

  // Display total: sum of each highlight's own (end - start) span, not
  // count * fixed segment duration -- with selection now uncapped, the
  // count can be large (up to highlights.maxCount) and the fixed-duration
  // multiplication would overstate a dense video's real total. Still
  // clamped to the source video's length as a display sanity bound.
  const totalHighlightsSeconds = Math.min(
    data.highlights.reduce((sum, highlight) => sum + Math.max(0, highlight.end - highlight.start), 0) || data.highlights.length * data.segmentDurationSeconds,
    videoDurationSeconds ?? Infinity
  );
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.min(100, Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100))
    : null;

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ink-main)]">Highlights reel</span>
        <span className="text-[10px] text-[var(--ink-muted)]">
          {data.highlights.length} keypoints · {fmtDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtDuration(videoDurationSeconds)}` : ''}
          {compressionPct !== null ? ` (${compressionPct}%)` : ''}
        </span>
      </div>

      <HighlightsTrack
        highlights={data.highlights}
        activeIndex={playingIdx}
        onSelect={jumpTo}
        videoDurationSeconds={videoDurationSeconds}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {playingIdx === null ? (
          <Button label="Play highlights" variant="primary" size="sm" onClick={start} />
        ) : (
          <Button label="Stop" variant="ghost" size="sm" onClick={stop} />
        )}

        <label className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
          Speed
          <select
            value={speed}
            onChange={(changeEvent) => handleSpeedChange(Number(changeEvent.target.value))}
            aria-label="Playback speed"
            className="text-[10px] rounded border border-[var(--border-muted)] bg-transparent px-1 py-0.5"
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
        <div className="text-xs text-[var(--ink-secondary)] leading-snug" aria-live="polite">
          <span className="font-mono text-[10px] text-[var(--ink-muted)] mr-1">
            {playingIdx! + 1}/{data.highlights.length}
          </span>
          {revealedText || activeHighlight.label}
        </div>
      )}
      {nextHighlight && (
        <div className="text-[10px] text-[var(--ink-muted)] italic truncate">
          Up next: {previewWords(nextHighlight.label)}
        </div>
      )}
    </div>
  );
}
