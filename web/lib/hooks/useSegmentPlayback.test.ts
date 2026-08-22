/**
 * Regression/contract test for the shared useSegmentPlayback hook
 * (extracted 2026-08-20, docs/agent-prompts/2026-08-20-cc-simplify-shared-
 * playback-hook.md). Exercises the media-time-clamping poll, seek-
 * settlement guard, and readiness guard against a fake in-memory
 * primitives implementation -- this is the exact state machine both
 * HighlightsScrubber.tsx and PublicHighlightsReel.tsx previously
 * duplicated, so proving it here proves both call sites' shared behavior.
 *
 * Follows the renderHook + @vitest-environment happy-dom pattern from
 * AnalysisHistory-restore.test.tsx. Uses vi.useFakeTimers() to drive the
 * hook's internal setInterval deterministically.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegmentPlayback, type SegmentPlaybackPrimitives } from './useSegmentPlayback';

function makeFakePrimitives(initialTime: number | null = null) {
  let currentTime = initialTime;
  const seekCalls: number[] = [];
  const rateCalls: number[] = [];
  let playCalls = 0;

  const primitives: SegmentPlaybackPrimitives = {
    getCurrentTime: () => currentTime,
    seekTo: (seconds: number) => {
      seekCalls.push(seconds);
      // Simulate instantaneous seek settlement by default; tests that need
      // to exercise the pending-seek guard call setTime with a mismatched
      // value first instead.
      currentTime = seconds;
    },
    play: () => {
      playCalls++;
    },
    setPlaybackRate: (rate: number) => {
      rateCalls.push(rate);
    },
  };

  return {
    primitives,
    seekCalls,
    rateCalls,
    get playCalls() {
      return playCalls;
    },
    setTime: (nextTime: number | null) => {
      currentTime = nextTime;
    },
  };
}

const SEGMENTS = [
  { start: 10, end: 15 },
  { start: 30, end: 35 },
  { start: 60, end: 65 },
];

describe('useSegmentPlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports not ready while getCurrentTime returns null', () => {
    const fake = makeFakePrimitives(null);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.isReady).toBe(false);
  });

  it('becomes ready once getCurrentTime returns a real number', () => {
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
      vi.advanceTimersByTime(250);
    });
    expect(result.current.isReady).toBe(true);
  });

  it('start() seeks to the first segment lead-in and sets playingIdx to 0', () => {
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
    expect(fake.seekCalls).toEqual([8]); // 10 - 2 lead-in
    expect(fake.playCalls).toBe(1);
    expect(result.current.playingIdx).toBe(0);
  });

  it('advances to the next segment once media time crosses segment.end (variable-duration)', () => {
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
      result.current.start(); // seeks to 8, currentTime -> 8
    });
    act(() => {
      vi.advanceTimersByTime(250); // settle the pending seek at t=8
    });
    // Segment 0: start=10, end=15, leadIn=8. Variable-duration advance
    // uses segment.end (15), not leadIn + segmentDurationSeconds (13).
    act(() => {
      fake.setTime(15);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBe(1);
    expect(fake.seekCalls).toEqual([8, 28]); // second segment: 30 - 2
  });

  it('does not double-advance while a just-issued seek has not settled (seek-settlement guard)', () => {
    // A fake whose seekTo does NOT auto-settle currentTime (unlike the
    // default makeFakePrimitives helper) -- needed to actually observe the
    // pending-seek window rather than have it clear on the very next tick.
    let currentTime: number | null = 20; // stale time from BEFORE the seek,
    // still reading past segment 0's clamp window -- the exact race
    // EntityMentionTimeline.tsx's issueSeek/pendingSeekSeconds guard exists
    // to prevent (a stale read that looks like "already past segment end").
    const seekCalls: number[] = [];
    const primitives: SegmentPlaybackPrimitives = {
      getCurrentTime: () => currentTime,
      seekTo: (seconds: number) => seekCalls.push(seconds), // does NOT settle currentTime
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
      result.current.start(); // issues seekTo(8); pendingSeekTarget = 8
    });
    act(() => {
      vi.advanceTimersByTime(250); // poll tick sees stale currentTime=20
    });
    // Guard should suppress the advance entirely while pendingSeekTarget is
    // still set (currentTime=20 is nowhere near the target of 8), even
    // though 20 also reads well past segment 0's own end boundary (15).
    expect(seekCalls).toEqual([8]);
    expect(result.current.playingIdx).toBe(0);

    // Once currentTime actually reflects having reached the seek target,
    // the guard clears and normal clamping resumes.
    act(() => {
      currentTime = 8;
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBe(0); // still segment 0, within window
    act(() => {
      currentTime = 15; // now past segment 0's end for real
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBe(1);
    expect(seekCalls).toEqual([8, 28]);
  });

  it('start() before the primitive is ready queues the request instead of seeking immediately', () => {
    // Regression test: post-merge review found isReady was computed but
    // never enforced -- start()/jumpTo() called seekTo/play unconditionally
    // even while getCurrentTime() still returned null.
    const fake = makeFakePrimitives(null);
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
    expect(fake.seekCalls).toEqual([]);
    expect(fake.playCalls).toBe(0);
    expect(result.current.playingIdx).toBeNull();
    expect(result.current.isReady).toBe(false);

    // Player becomes ready on the next poll tick -- queued start flushes.
    act(() => {
      fake.setTime(0);
      vi.advanceTimersByTime(250);
    });
    expect(fake.seekCalls).toEqual([8]);
    expect(fake.playCalls).toBe(1);
    expect(result.current.playingIdx).toBe(0);
  });

  it('jumpTo() before the primitive is ready queues the request instead of seeking immediately', () => {
    const fake = makeFakePrimitives(null);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.jumpTo(2);
    });
    expect(fake.seekCalls).toEqual([]);
    expect(result.current.playingIdx).toBeNull();

    act(() => {
      fake.setTime(0);
      vi.advanceTimersByTime(250);
    });
    expect(fake.seekCalls).toEqual([58]);
    expect(result.current.playingIdx).toBe(2);
  });

  it('multiple pre-ready requests use latest-request-wins semantics', () => {
    const fake = makeFakePrimitives(null);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: SEGMENTS,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.start(); // queues index 0
      result.current.jumpTo(2); // overwrites queue with index 2
    });
    expect(fake.seekCalls).toEqual([]);

    act(() => {
      fake.setTime(0);
      vi.advanceTimersByTime(250);
    });
    // Only the last-queued request (index 2) flushes -- index 0 was
    // overwritten, not queued behind it.
    expect(fake.seekCalls).toEqual([58]);
    expect(result.current.playingIdx).toBe(2);
  });

  it('unmounting while a start is queued does not flush it after unmount', () => {
    const fake = makeFakePrimitives(null);
    const { result, unmount } = renderHook(() =>
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
    unmount(); // runs the hook's own unmount cleanup (stop())
    act(() => {
      fake.setTime(0);
      vi.advanceTimersByTime(250);
    });
    expect(fake.seekCalls).toEqual([]);
  });

  it('stop() while a start is queued cancels the queued start', () => {
    const fake = makeFakePrimitives(null);
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
      result.current.stop();
    });
    act(() => {
      fake.setTime(0);
      vi.advanceTimersByTime(250);
    });
    expect(fake.seekCalls).toEqual([]);
    expect(result.current.playingIdx).toBeNull();
  });

  it('stop() clears playingIdx and elapsed time', () => {
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
      result.current.stop();
    });
    expect(result.current.playingIdx).toBeNull();
    expect(result.current.elapsedInSegmentSeconds).toBeNull();
  });

  it('jumpTo() seeks directly to an arbitrary segment index', () => {
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
      result.current.jumpTo(2);
    });
    expect(result.current.playingIdx).toBe(2);
    expect(fake.seekCalls).toEqual([58]); // 60 - 2
  });

  it('setSpeed() updates state and calls the primitive', () => {
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
      result.current.setSpeed(2);
    });
    expect(result.current.speed).toBe(2);
    expect(fake.rateCalls).toEqual([2]);
  });

  it('advancing past the last segment stops playback (playingIdx -> null)', () => {
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
      result.current.jumpTo(2); // last segment, seeks to 58
    });
    act(() => {
      vi.advanceTimersByTime(250); // settle
    });
    act(() => {
      fake.setTime(65); // segment.end for last segment (60+5=65... actually 65)
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBeNull();
  });

  // --- Variable-duration advance regression tests (C4, 2026-08-23) ---
  // The hook now advances on segment.end (when valid) instead of the fixed
  // segmentDurationSeconds. These cases prove each branch of the fallback logic.

  it('advances at segment.end for a long highlight (end-start = 60s)', () => {
    const longSegments = [{ start: 100, end: 160 }];
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: longSegments,
        contextLeadSeconds: 0,
        segmentDurationSeconds: 10,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.start(); // seeks to 100
    });
    act(() => {
      vi.advanceTimersByTime(250); // settle
    });
    // At t=110 (100 + segmentDurationSeconds=10), should NOT advance yet —
    // the real end is 160, not 110.
    act(() => {
      fake.setTime(110);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBe(0);
    // At t=160 (segment.end), should advance (to null — last segment)
    act(() => {
      fake.setTime(160);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBeNull();
  });

  it('falls back to segmentDurationSeconds when segment.end is null (legacy data)', () => {
    const legacySegments = [{ start: 10, end: NaN }];
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: legacySegments,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.start(); // seeks to 8
    });
    act(() => {
      vi.advanceTimersByTime(250); // settle
    });
    // end is NaN (not Number.isFinite), so fallback: leadIn + segmentDurationSeconds = 8 + 5 = 13
    act(() => {
      fake.setTime(13);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBeNull(); // advanced past last segment
  });

  it('falls back to segmentDurationSeconds when end < start (invalid data)', () => {
    const invalidSegments = [{ start: 10, end: 5 }];
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments: invalidSegments,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => {
      result.current.start(); // seeks to 8
    });
    act(() => {
      vi.advanceTimersByTime(250); // settle
    });
    // end (5) is not > start (10), so fallback: leadIn + segmentDurationSeconds = 8 + 5 = 13
    act(() => {
      fake.setTime(13);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.playingIdx).toBeNull(); // advanced past last segment
  });
});
