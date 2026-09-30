/**
 * 2026-09-30 highlights-reel bug-fix regression tests (dispatch prompt
 * docs/agent-prompts/2026-09-30-oc-highlights-jump-and-ticker.md, R3b step 2).
 * Split out of useSegmentPlayback.test.ts (which was pushed past the 500-line
 * qa-intel "Monolithic File" threshold by these additions).
 *
 * Live-reported bugs covered here:
 * 1. Manual jump doesn't play (seek never settles → frozen forever; jump
 *    while paused; pending-over-pending retarget).
 * 3. Segments start a few seconds late (YouTube keyframe overshoot held the
 *    settlement guard for the full timeout).
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegmentPlayback, type SegmentPlaybackPrimitives } from './useSegmentPlayback';

const SEGMENTS = [
  { start: 10, end: 15 },
  { start: 30, end: 35 },
  { start: 60, end: 65 },
];

function makeFakePrimitives(initialTime: number | null = null) {
  let currentTime = initialTime;
  const seekCalls: number[] = [];
  let playCalls = 0;

  const primitives: SegmentPlaybackPrimitives = {
    getCurrentTime: () => currentTime,
    seekTo: (seconds: number) => {
      seekCalls.push(seconds);
      currentTime = seconds;
    },
    play: () => {
      playCalls++;
    },
    setPlaybackRate: () => {},
  };

  return {
    primitives,
    seekCalls,
    get playCalls() {
      return playCalls;
    },
    setTime: (nextTime: number | null) => {
      currentTime = nextTime;
    },
  };
}

describe('useSegmentPlayback — 2026-09-30 jump/settlement fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(c) jumpTo while paused resumes playback of the target segment', () => {
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.isPaused).toBe(true);
    act(() => {
      result.current.jumpTo(2);
    });
    // jumpTo must clear the paused flag and issue a real play so the
    // segment actually plays (live report: "manual click doesn't kick in").
    expect(result.current.isPaused).toBe(false);
    expect(result.current.playingIdx).toBe(2);
    expect(fake.playCalls).toBeGreaterThanOrEqual(2); // start + resume-via-jump
  });

  it('(a) a seek that never settles times out and playback proceeds from actual current time (was: frozen forever)', () => {
    // Same non-settling fake as the settlement-guard test, but the seek
    // NEVER settles — the exact live failure mode (stale/paused store time,
    // YouTube seek landing outside the ±1s tolerance window).
    let currentTime: number | null = 0;
    const seekCalls: number[] = [];
    const primitives: SegmentPlaybackPrimitives = {
      getCurrentTime: () => currentTime,
      seekTo: (seconds: number) => seekCalls.push(seconds), // does NOT settle
      play: () => {},
      setPlaybackRate: () => {},
    };
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives,
      })
    );
    act(() => {
      result.current.jumpTo(1); // seek to 28, pendingSeekTarget = 28
    });
    expect(result.current.playingIdx).toBe(1);
    // 3 seconds of polls with a never-settling seek — well past the 2s
    // settlement timeout. Before the fix, the pending guard returned early
    // on every tick forever: elapsed stayed frozen and no advance could
    // ever happen.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Timeout cleared the pending guard: elapsed now derives from actual
    // current time (0 - 28 → clamped to 0) instead of staying pinned at the
    // initial 0 from playFrom with the guard silently swallowing updates.
    expect(result.current.elapsedInSegmentSeconds).toBe(0);
    // And the advance machine is live again: crossing the segment's real
    // end advances to the next segment instead of being swallowed.
    act(() => {
      currentTime = 35;
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBe(2);
    expect(seekCalls).toEqual([28, 58]);
  });

  it('(d) jumpTo while a previous pendingSeekTarget is still pending retargets to the new segment', () => {
    let currentTime: number | null = 0;
    const seekCalls: number[] = [];
    const primitives: SegmentPlaybackPrimitives = {
      getCurrentTime: () => currentTime,
      seekTo: (seconds: number) => seekCalls.push(seconds),
      play: () => {},
      setPlaybackRate: () => {},
    };
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives,
      })
    );
    act(() => {
      result.current.jumpTo(1); // pending target 28, never settles
    });
    act(() => {
      vi.advanceTimersByTime(250); // one tick with the guard holding
    });
    act(() => {
      result.current.jumpTo(2); // latest-request-wins retarget to 58
    });
    expect(seekCalls).toEqual([28, 58]);
    expect(result.current.playingIdx).toBe(2);
    // The NEW target settles when currentTime reaches it (old target must
    // not be the one the guard compares against).
    act(() => {
      currentTime = 58;
      vi.advanceTimersByTime(250);
    });
    expect(result.current.elapsedInSegmentSeconds).toBe(0); // 58 - leadIn(58)
    expect(result.current.playingIdx).toBe(2);
  });

  it('(bug-3) elapsed starts from the actual landed player time, never accumulated during a pending seek', () => {
    // Bug-3 (2026-09-30 live report: "segments sometimes start a few seconds
    // after the highlight's start"). The hook-side contract: elapsed time
    // NEVER goes negative and never starts "late" by more than the poll
    // cadence — elapsedInSegmentSeconds is computed from the actual polled
    // player time each tick, so when the player lands exactly at (or before)
    // leadIn, the first visible elapsed is 0, not leadIn + poll jitter.
    // YouTube's iframe seekTo keyframe-snapping can land AFTER the requested
    // time (outside the hook's control); this test pins that even then, the
    // hook reports elapsed from the actual landed position (no phantom
    // elapsed accumulated while the seek was pending).
    let currentTime: number | null = 0;
    const primitives: SegmentPlaybackPrimitives = {
      getCurrentTime: () => currentTime,
      seekTo: (seconds: number) => {
        // Simulate YouTube keyframe snapping: lands 1.5s AFTER the
        // requested leadIn (outside the ±1s settlement tolerance).
        currentTime = seconds + 1.5;
      },
      play: () => {},
      setPlaybackRate: () => {},
    };
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives,
      })
    );
    act(() => {
      result.current.jumpTo(1); // seek to 28, player lands at 29.5
    });
    expect(result.current.playingIdx).toBe(1);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // Elapsed reflects where the player ACTUALLY is (29.5 - 28 = 1.5s into
    // the lead-in), not 0 held from playFrom — and never negative.
    expect(result.current.elapsedInSegmentSeconds).toBe(1.5);
  });
});
