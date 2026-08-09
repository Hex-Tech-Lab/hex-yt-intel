import { describe, it, expect } from 'vitest';
import { groupSegmentsIntoChunks } from '../services/ChunkGrouping';
import type { TranscriptSegment } from '../ports/TranscriptProviderPort';

function seg(start: number, duration: number, text: string): TranscriptSegment {
  return { start, duration, text };
}

describe('groupSegmentsIntoChunks (ADR 026 §4.1)', () => {
  it('returns an empty array for no segments', () => {
    expect(groupSegmentsIntoChunks([])).toEqual([]);
  });

  it('never splits a segment across two chunks', () => {
    // A single segment that spans the whole target window on its own must
    // still land in exactly one chunk, not be truncated.
    const segments = [seg(0, 100, 'a very long single segment')];
    const chunks = groupSegmentsIntoChunks(segments, 75);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.segments).toEqual(segments);
  });

  it('closes a chunk before the next segment would overshoot the target window', () => {
    const segments = [
      seg(0, 30, 'first'),
      seg(30, 30, 'second'), // span so far: 60s
      seg(60, 30, 'third'),  // would make span 90s > 75s target -> new chunk
    ];
    const chunks = groupSegmentsIntoChunks(segments, 75);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toBe('first second');
    expect(chunks[0]!.startSeconds).toBe(0);
    expect(chunks[0]!.endSeconds).toBe(60);
    expect(chunks[1]!.text).toBe('third');
    expect(chunks[1]!.startSeconds).toBe(60);
  });

  it('assigns real, monotonically increasing chunk timestamps with exact segment coverage (no drops, no duplicates, no reordering)', () => {
    const segments = [
      seg(0, 20, 'one'),
      seg(20, 20, 'two'),
      seg(40, 20, 'three'),
      seg(60, 20, 'four'),
      seg(80, 20, 'five'),
    ];
    const chunks = groupSegmentsIntoChunks(segments, 45);
    // Cubic (PR #227 review): a count-only check would pass even if a real
    // segment were dropped and a duplicate substituted -- assert identity.
    const flattened = chunks.flatMap((chunk) => chunk.segments);
    expect(flattened).toEqual(segments);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startSeconds).toBeGreaterThanOrEqual(chunks[i - 1]!.endSeconds);
    }
  });

  it('sorts out-of-order input before grouping, so chunk timestamps stay monotonic', () => {
    const outOfOrder = [seg(40, 20, 'three'), seg(0, 20, 'one'), seg(20, 20, 'two')];
    const chunks = groupSegmentsIntoChunks(outOfOrder, 45);
    const flattened = chunks.flatMap((chunk) => chunk.segments);
    expect(flattened.map((segment) => segment.text)).toEqual(['one', 'two', 'three']);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startSeconds).toBeGreaterThanOrEqual(chunks[i - 1]!.endSeconds);
    }
  });

  it('falls back to the default window for a non-finite target (Infinity/NaN), not just non-positive (Cubic follow-up)', () => {
    const segments = [seg(0, 20, 'one'), seg(20, 20, 'two'), seg(40, 20, 'three')];
    const defaultWindow = groupSegmentsIntoChunks(segments);
    expect(groupSegmentsIntoChunks(segments, Infinity)).toEqual(defaultWindow);
    expect(groupSegmentsIntoChunks(segments, NaN)).toEqual(defaultWindow);
  });

  it('uses a real default target window when none is passed', () => {
    const segments = [seg(0, 10, 'a'), seg(10, 10, 'b')];
    expect(() => groupSegmentsIntoChunks(segments)).not.toThrow();
  });

  it('falls back to the default window instead of degrading to one-chunk-per-segment on a non-positive window (Cubic/Sourcery PR #227 finding)', () => {
    const segments = [seg(0, 20, 'one'), seg(20, 20, 'two'), seg(40, 20, 'three')];
    const zeroWindow = groupSegmentsIntoChunks(segments, 0);
    const negativeWindow = groupSegmentsIntoChunks(segments, -10);
    const defaultWindow = groupSegmentsIntoChunks(segments);
    expect(zeroWindow).toEqual(defaultWindow);
    expect(negativeWindow).toEqual(defaultWindow);
    expect(zeroWindow).toHaveLength(1);
  });
});
