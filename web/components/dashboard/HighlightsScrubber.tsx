'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Selector, Spinner } from '@astryxdesign/core';
import { useVideoStore } from '@/store/useVideoStore';
import { fmtHighlightsDuration } from '@/lib/utils/highlights-settings';
import { HighlightsTrack } from '@/components/dashboard/HighlightsTrack';
import { useHighlightTicker, previewWords } from '@/lib/hooks/useHighlightTicker';
import { useSegmentPlayback, SPEED_OPTIONS, type SegmentPlaybackPrimitives } from '@/lib/hooks/useSegmentPlayback';

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
 *
 * The segment-advance state machine itself (media-time-clamping poll,
 * seek-settlement guard, speed state) is owned by the shared
 * `useSegmentPlayback` hook (extracted 2026-08-20, see
 * docs/agent-prompts/2026-08-20-cc-simplify-shared-playback-hook.md) --
 * this component only supplies the store-backed primitives and renders.
 */
export function HighlightsScrubber({ analysisId, videoDurationSeconds }: { analysisId: string; videoDurationSeconds: number | null }) {
  const [data, setData] = useState<HighlightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setSeekTo = useVideoStore((state) => state.setSeekTo);
  const setPlaybackRate = useVideoStore((state) => state.setPlaybackRate);

  // Store-backed primitives -- getCurrentTime reads the store value
  // directly; VideoPlayerCard's own 250ms poll keeps currentPlaybackSeconds
  // fresh, so no second poller here. currentPlaybackSeconds is null until
  // playback first starts (not "player not mounted" -- VideoPlayerCard is
  // already mounted by the time this component renders), so null must map
  // to t=0, not "not ready" (PR #264: mapping it to "not ready" deadlocked
  // the Play button, since nothing else would ever flip isPlaying to make
  // it non-null). PublicHighlightsReel.tsx's own primitives are correctly
  // different -- its null really does mean "player iframe not mounted yet".
  const primitives: SegmentPlaybackPrimitives = useMemo(
    () => ({
      getCurrentTime: () => useVideoStore.getState().currentPlaybackSeconds ?? 0,
      seekTo: setSeekTo, // setSeekTo already flips isPlaying -- no separate play() needed
      setPlaybackRate,
    }),
    [setSeekTo, setPlaybackRate]
  );

  const segments = useMemo(() => data?.highlights ?? [], [data]);

  const { playingIdx, elapsedInSegmentSeconds, speed, start, stop, jumpTo, setSpeed } = useSegmentPlayback({
    segments,
    contextLeadSeconds: data?.contextLeadSeconds ?? 0,
    segmentDurationSeconds: data?.segmentDurationSeconds ?? 10,
    primitives,
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop is stable
    // (useSegmentPlayback's own useCallback with an empty dep array).
  }, [analysisId]);

  const activeHighlight = data && playingIdx !== null ? data.highlights[playingIdx] : null;
  const nextHighlight = data && playingIdx !== null ? data.highlights[playingIdx + 1] : null;
  const { revealedText } = useHighlightTicker(
    playingIdx,
    activeHighlight?.label ?? null,
    data?.segmentDurationSeconds ?? 10,
    elapsedInSegmentSeconds
  );

  const speedOptions = useMemo(() => SPEED_OPTIONS.map((rate) => `${rate}x`), []);

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
    <Card variant="transparent" padding={3} className="flex flex-col gap-2 border border-[var(--border-muted)] bg-[var(--surface)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ink)]">Highlights reel</span>
        <span className="text-[10px] text-[var(--ink-muted)]">
          {data.highlights.length} keypoints · {fmtHighlightsDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtHighlightsDuration(videoDurationSeconds)}` : ''}
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

        <span className="flex items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
          Speed
          <Selector
            label="Playback speed"
            isLabelHidden
            size="sm"
            value={`${speed}x`}
            onChange={(val) => setSpeed(Number(val.replace('x', '')))}
            options={speedOptions}
            width={80}
          />
        </span>
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
    </Card>
  );
}
