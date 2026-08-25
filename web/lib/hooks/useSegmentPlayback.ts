'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HIGHLIGHTS_SPEED_MIN, HIGHLIGHTS_SPEED_MAX } from '@/lib/utils/highlights-settings';

/**
 * Shared playback-engine hook for the highlights reel (extracted 2026-08-20
 * per docs/agent-prompts/2026-08-20-cc-simplify-shared-playback-hook.md --
 * follow-up to PR #258's /simplify findings).
 *
 * `HighlightsScrubber.tsx` (authed dashboard, `useVideoStore`-backed) and
 * `PublicHighlightsReel.tsx` (anonymous /share view, `YouTubePlayerAdapter`
 * -backed) independently implemented the SAME segment-advance state machine:
 * a media-time-clamping poll, a seek-settlement guard, and a speed-scaled
 * advance-to-next-segment. Only the time-source primitive differed. This
 * hook owns that shared machine; each caller supplies its own primitives.
 *
 * `getCurrentTime` deliberately returns `number | null` rather than
 * `VideoPlayerPort`'s plain `number` -- narrower than that port on purpose.
 * `PublicHighlightsReel` needs to represent "player not ready yet" (its
 * `ready` boolean today) and the hook's own built-in readiness guard
 * (finding #3) depends on being able to see that as `null` rather than a
 * misleading `0`. `VideoPlayerPort.getCurrentTime()` doesn't return null
 * today; rather than force a fit or widen that port's contract for every
 * other caller, this hook defines its own narrower primitive shape and each
 * caller adapts its own port/store to it (see call-site wiring).
 */
export interface SegmentPlaybackPrimitives {
  /** Real player/store media time in seconds, or null when not yet known
   *  (player not mounted/ready, or store hasn't received a first tick). */
  getCurrentTime: () => number | null;
  seekTo: (seconds: number) => void;
  /** Optional: not every primitive source needs an explicit resume call
   *  (the store-backed variant's setSeekTo already flips isPlaying). Also
   *  used by resume() to un-pause without re-seeking. */
  play?: () => void;
  /** Optional: used by pause() to actually pause the underlying player
   *  without resetting playingIdx/position (unlike stop()). */
  pause?: () => void;
  setPlaybackRate: (rate: number) => void;
}

export interface Segment {
  start: number;
  end: number;
}

export interface UseSegmentPlaybackOptions {
  segments: Segment[];
  /** Seconds to play before each segment's `start` so playback doesn't open
   *  mid-sentence (highlights.contextLeadSeconds, Settings Registry). */
  contextLeadSeconds: number;
  /** Fallback per-segment duration when a segment has no usable real end
   *  (legacy/null data). When a segment does have a valid `end > start`,
   *  playback advances at that real end, not this fixed value. */
  segmentDurationSeconds: number;
  primitives: SegmentPlaybackPrimitives;
  /** Poll cadence in ms for the media-time-clamping watcher. Matches
   *  VideoPlayerCard.POLL_INTERVAL_MS (250ms) by default -- pass a lower
   *  value only if a caller has no shared store tick to piggyback on and
   *  must run its own setInterval (PublicHighlightsReel). */
  pollIntervalMs?: number;
}

// Explicit list (2026-08-20 layout revision) rather than derived from
// MIN/MAX alone -- 0.8 and 1.2 aren't evenly spaced, both are real speed
// options now. HIGHLIGHTS_SPEED_MIN/MAX (0.5/3) still bound the list and
// the adapter clamp -- keep both endpoints in sync if this list ever
// changes range.
export const SPEED_OPTIONS = [HIGHLIGHTS_SPEED_MIN, 0.8, 1.0, 1.2, 1.5, 2.0, HIGHLIGHTS_SPEED_MAX] as const;

const DEFAULT_POLL_INTERVAL_MS = 250;
/** Lead buffer before a segment's end counts as "reached" -- accounts for
 *  poll cadence coarseness (mirrors both original implementations' 0.3s). */
const ADVANCE_LEAD_SECONDS = 0.3;
/** Seek-settlement tolerance -- mirrors EntityMentionTimeline.tsx's
 *  issueSeek/pendingSeekSeconds pattern (symmetric absolute-distance check,
 *  not a forward-only comparison -- see that file's own comment for the
 *  backward-seek bug a forward-only check reintroduces). */
const SEEK_SETTLEMENT_TOLERANCE_SECONDS = 1;

export interface UseSegmentPlaybackResult {
  /** Index of the currently-playing segment, or null when stopped. */
  playingIdx: number | null;
  /** Elapsed seconds into the current segment (from its lead-in start), or
   *  null when nothing is playing / time isn't known yet. Exposed so
   *  useHighlightTicker can consume it instead of running its own timer. */
  elapsedInSegmentSeconds: number | null;
  speed: number;
  /** Whether the hook's own readiness primitive currently allows starting/
   *  advancing playback (i.e. getCurrentTime() isn't null). Distinct from
   *  "should the component render at all" -- callers may still choose a
   *  component-level guard for other reasons (nothing to show, etc). */
  isReady: boolean;
  /** Both `start()` and `jumpTo()` queue their request (latest-request-wins:
   *  a scalar ref, not a FIFO queue) when the primitive isn't ready yet, and
   *  flush on the next poll tick where it becomes ready. Both current call
   *  sites (`HighlightsScrubber.tsx`, `PublicHighlightsReel.tsx`) only wire
   *  these to user click handlers, never at mount/effect time, so the
   *  pre-ready path is a defensive guard today, not a load-bearing race a
   *  caller relies on. `stop()` (including the hook's own unmount cleanup)
   *  cancels any pending queued request. */
  start: () => void;
  stop: () => void;
  jumpTo: (index: number) => void;
  setSpeed: (rate: number) => void;
  /** True while playingIdx is non-null but the poll loop is not advancing
   *  (pause() was called, not stop()). */
  isPaused: boolean;
  /** Real bug fix (live report, 2026-08-21): the UI previously faked "pause"
   *  with stop() (which nulls playingIdx) and faked "resume" with start()
   *  (which always replays from index 0) -- so pressing pause then play
   *  jumped back to the first highlight regardless of where playback
   *  actually was. pause()/resume() preserve playingIdx and the underlying
   *  player position; only the poll loop's advance-to-next-segment check is
   *  suspended while paused. */
  pause: () => void;
  resume: () => void;
}

export function useSegmentPlayback({
  segments,
  contextLeadSeconds,
  segmentDurationSeconds,
  primitives,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseSegmentPlaybackOptions): UseSegmentPlaybackResult {
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [speed, setSpeedState] = useState<number>(1);
  const [elapsedInSegmentSeconds, setElapsedInSegmentSeconds] = useState<number | null>(null);
  const stopRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);
  const pendingSeekTargetRef = useRef<number | null>(null);
  // Real bug fix (post-merge review): `isReady` was computed and returned but
  // never actually consulted by `start`/`jumpTo` -- both called `seekTo`/
  // `play` unconditionally, so a caller invoking them before the primitive
  // had a real current time (player not mounted/ready yet) fired a seek/play
  // against a not-yet-ready player. `pendingStartIndexRef` queues the request;
  // the poll loop below flushes it as soon as `getCurrentTime()` stops
  // returning null, instead of silently dropping it.
  const pendingStartIndexRef = useRef<number | null>(null);

  // Primitives/segments identity churns every render for callers that pass
  // fresh closures (both current call sites do) -- keep the poll effect's
  // dependency array stable by reading through refs instead of re-running
  // the interval/effect on every parent re-render.
  const primitivesRef = useRef(primitives);
  primitivesRef.current = primitives;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const contextLeadRef = useRef(contextLeadSeconds);
  contextLeadRef.current = contextLeadSeconds;
  const segmentDurationRef = useRef(segmentDurationSeconds);
  segmentDurationRef.current = segmentDurationSeconds;

  const stop = useCallback(() => {
    stopRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
    pendingSeekTargetRef.current = null;
    pendingStartIndexRef.current = null;
    setPlayingIdx(null);
    setElapsedInSegmentSeconds(null);
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setIsPaused(true);
    primitivesRef.current.pause?.();
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    primitivesRef.current.play?.();
  }, []);

  useEffect(() => stop, [stop]); // unmount cleanup

  const playFrom = useCallback((index: number) => {
    const currentSegments = segmentsRef.current;
    if (index >= currentSegments.length) {
      setPlayingIdx(null);
      pendingSeekTargetRef.current = null;
      pendingStartIndexRef.current = null;
      setElapsedInSegmentSeconds(null);
      return;
    }
    if (primitivesRef.current.getCurrentTime() === null) {
      pendingStartIndexRef.current = index;
      return;
    }
    pendingStartIndexRef.current = null;
    pausedRef.current = false;
    setIsPaused(false);
    const segment = currentSegments[index]!;
    const leadIn = Math.max(0, segment.start - contextLeadRef.current);
    pendingSeekTargetRef.current = leadIn;
    primitivesRef.current.seekTo(leadIn);
    primitivesRef.current.play?.();
    setPlayingIdx(index);
    setElapsedInSegmentSeconds(0);
  }, []);

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

  const setSpeed = useCallback((rate: number) => {
    setSpeedState(rate);
    primitivesRef.current.setPlaybackRate(rate);
  }, []);

  // Media-time-clamping poll + seek-settlement guard (finding #1). Runs
  // continuously (not just while playing) so `isReady` below reflects
  // primitive readiness even before playback starts.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    const tick = () => {
      const currentTime = primitivesRef.current.getCurrentTime();
      setIsReady(currentTime !== null);

      if (currentTime !== null && pendingStartIndexRef.current !== null && !stopRef.current) {
        const queuedIndex = pendingStartIndexRef.current;
        pendingStartIndexRef.current = null;
        playFrom(queuedIndex);
        return;
      }

      if (stopRef.current || pausedRef.current) return;
      const idx = playingIdx;
      if (idx === null || currentTime === null) return;
      const segment = segmentsRef.current[idx];
      if (!segment) return;
      const leadIn = Math.max(0, segment.start - contextLeadRef.current);

      const pendingTarget = pendingSeekTargetRef.current;
      if (pendingTarget !== null) {
        if (Math.abs(currentTime - pendingTarget) <= SEEK_SETTLEMENT_TOLERANCE_SECONDS) {
          pendingSeekTargetRef.current = null;
        }
        return;
      }

      setElapsedInSegmentSeconds(Math.max(0, currentTime - leadIn));

      // Advance at the segment's actual end time, not a fixed duration, so the
      // ticker and playback duration align exactly with the segment's span.
      // Total duration from leadIn is (segment.end - segment.start) + contextLead.
      const segmentEnd = (Number.isFinite(segment.end) && segment.end > segment.start)
        ? segment.end
        : leadIn + segmentDurationRef.current;
      if (currentTime >= segmentEnd - ADVANCE_LEAD_SECONDS) {
        playFrom(idx + 1);
      }
    };
    const intervalId = setInterval(tick, pollIntervalMs);
    tick(); // don't wait a full interval for the first readiness read
    return () => clearInterval(intervalId);
    // playingIdx intentionally the only reactive dep -- primitives/segments/
    // contextLeadSeconds are read through refs (see above) so this interval
    // isn't torn down and recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingIdx, pollIntervalMs, playFrom]);

  return { playingIdx, elapsedInSegmentSeconds, speed, isReady, isPaused, start, stop, pause, resume, jumpTo, setSpeed };
}
