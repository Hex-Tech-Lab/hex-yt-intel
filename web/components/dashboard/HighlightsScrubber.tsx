'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, IconButton, Spinner } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { useVideoStore } from '@/store/useVideoStore';
import { fmtHighlightsDuration, HIGHLIGHTS_REGISTRY_FALLBACK } from '@/lib/utils/highlights-settings';
import { HighlightsTrack, HighlightsNav, TRACK_HEIGHT_PX } from '@/components/dashboard/HighlightsTrack';
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
      // Real bug fix (live report, 2026-08-21): resume() must NOT re-seek --
      // it only needs to flip isPlaying back on, which VideoPlayerCard's own
      // isPlaying effect is the sole authority for (see its play/pause
      // effect). pause() is the same store flag, the other direction.
      play: () => useVideoStore.getState().setPlaying(true),
      pause: () => useVideoStore.getState().setPlaying(false),
      setPlaybackRate,
    }),
    [setSeekTo, setPlaybackRate]
  );

  const segments = useMemo(() => data?.highlights ?? [], [data]);

  const { playingIdx, elapsedInSegmentSeconds, speed, isPaused, start, stop, pause, resume, jumpTo, setSpeed } = useSegmentPlayback({
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
  const activeDuration = activeHighlight && Number.isFinite(activeHighlight.end) && activeHighlight.end > activeHighlight.start
    ? Math.max(1, activeHighlight.end - activeHighlight.start)
    : (data?.segmentDurationSeconds ?? 10);
  const { revealedText } = useHighlightTicker(
    playingIdx,
    activeHighlight?.label ?? null,
    activeDuration,
    elapsedInSegmentSeconds,
    activeHighlight?.verbatimExcerpt ?? null
  );

  // Real fix (live report, 2026-08-20): the Astryx <Selector> dropdown read
  // as an oversized grey box out of step with the rest of the design, and
  // repeating chevrons right next to HighlightsNav's own prev/next arrows
  // was flagged as visual clutter. Replaced with a minimal tap-to-cycle
  // pill (no dropdown, no chevrons) -- click advances to the next speed in
  // SPEED_OPTIONS, wrapping back to the start after the last one.
  const cycleSpeed = () => {
    const currentIdx = SPEED_OPTIONS.indexOf(speed as (typeof SPEED_OPTIONS)[number]);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % SPEED_OPTIONS.length;
    setSpeed(SPEED_OPTIONS[nextIdx]!);
  };

  if (error) return null; // No highlights available (analysis predates the feature, or extraction failed) -- fail quiet, not a broken UI.
  if (loading || !data) return <Spinner size="sm" />;
  if (data.highlights.length === 0) return null;

  // Sum each highlight's real clamped duration (fallback to
  // segmentDurationSeconds when end is null/invalid), matching the
  // variable-duration playback advance on segment.end.
  const minDur = HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'];
  const maxDur = HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'];
  const totalHighlightsSeconds = Math.min(
    data.highlights.reduce((sum, highlight) => {
      const dur = (Number.isFinite(highlight.end) && highlight.end > highlight.start) ? (highlight.end - highlight.start) : data.segmentDurationSeconds;
      return sum + Math.min(maxDur, Math.max(minDur, dur));
    }, 0),
    videoDurationSeconds ?? Infinity
  );
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.min(100, Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100))
    : null;

  return (
    <Card variant="transparent" padding={3} className="flex flex-col gap-2 border border-[var(--border-muted)] bg-[var(--surface)]">
      {/* Header row: title left, keypoint/duration stats right -- the
          moment stepper moved to the footer row (below) per the 2nd
          layout revision, replacing the old text-label Play button slot. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--ink)]">Highlights Reel</span>
        <span className="text-[10px] text-[var(--ink-muted)] whitespace-nowrap">
          {data.highlights.length} keypoints · {fmtHighlightsDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtHighlightsDuration(videoDurationSeconds)}` : ''}
          {compressionPct !== null ? ` (${compressionPct}%)` : ''}
        </span>
      </div>

      {/* Timeline row: the track stays one continuous element (real
          highlight-timestamp positions preserved -- unlike a visually
          split two-segment track, which would misplace markers relative
          to their true percentage position). Play/Pause sits flush right
          as a real flex sibling (not a centered overlay -- corrected per
          live feedback), shortening the track by exactly the button's own
          width instead of floating over the middle of it. */}
      {/* Real fix (live report, 2026-08-21): items-center here used to
          vertically center the Play/Pause button against this row's FULL
          height -- fine when HighlightsTrack was just its own fixed-height
          track, but once the density-gated permanent-label row was added
          below it, the row grew taller and the button drifted down, no
          longer aligned with the track itself. items-start + a wrapper
          sized to HighlightsTrack's own exported TRACK_HEIGHT_PX (not a
          second hardcoded height duplicating that file's internals --
          /simplify altitude finding, 2026-08-21) pins the button to the
          track's own height regardless of whatever renders below. */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <HighlightsTrack
            highlights={data.highlights}
            activeIndex={playingIdx}
            onSelect={jumpTo}
            videoDurationSeconds={videoDurationSeconds}
            segmentDurationSeconds={data.segmentDurationSeconds}
            hideNav
          />
        </div>
        <div className="flex items-center" style={{ height: TRACK_HEIGHT_PX }}>
          {/* Real bug fix (live report, 2026-08-21): this used to toggle
              start()/stop() -- stop() nulled playingIdx entirely, so
              pressing "pause" then "play" again always replayed from
              highlight #1 instead of resuming where it was. Now toggles
              start (nothing playing) / pause (playing, not paused) /
              resume (playing, paused) -- playingIdx and player position
              are preserved across pause/resume. */}
          <IconButton
            label={playingIdx === null ? 'Play highlights' : isPaused ? 'Resume highlights' : 'Pause highlights'}
            icon={<Icon icon={playingIdx === null || isPaused ? 'solar:play-bold' : 'solar:pause-bold'} size={14} />}
            variant="primary"
            size="sm"
            onClick={playingIdx === null ? start : isPaused ? resume : pause}
          />
        </div>
      </div>

      {/* Footer row: live transcript ticker (left, grows/truncates) +
          Speed cycle-pill + relocated moment stepper (right). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0 text-xs text-[var(--ink-secondary)] leading-snug truncate" aria-live="polite">
          {activeHighlight ? (
            <>
              <span className="font-mono text-[10px] text-[var(--ink-muted)] mr-1">
                {playingIdx! + 1}/{data.highlights.length}
              </span>
              {revealedText || activeHighlight.label}
            </>
          ) : nextHighlight ? (
            <span className="italic text-[var(--ink-muted)]">Up next: {previewWords(nextHighlight.label)}</span>
          ) : (
            <span className="text-[var(--ink-muted)]">{data.highlights.length} keypoints ready to play</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Real fix (live report, 2026-08-21): height was left to derive
              from padding + line-height (21px rendered) while HighlightsNav's
              own strip derives its height from its fixed h-4 buttons (18px
              rendered) -- the two only coincidentally looked close, never
              pixel-matched. Both now share an explicit h-5, verified
              (getBoundingClientRect) to render identically. */}
          <button
            type="button"
            onClick={cycleSpeed}
            title="Cycle playback speed"
            aria-label={`Playback speed: ${speed}x. Click to change.`}
            className="h-5 inline-flex items-center text-[10px] font-mono font-medium text-[var(--ink-muted)] hover:text-[var(--accent)] px-1.5 border border-[var(--line)] hover:border-[var(--accent-a70)]"
          >
            {speed}x
          </button>
          <HighlightsNav highlights={data.highlights} activeIndex={playingIdx} onSelect={jumpTo} />
        </div>
      </div>
    </Card>
  );
}
