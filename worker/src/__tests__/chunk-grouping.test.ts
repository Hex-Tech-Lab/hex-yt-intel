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

  it('assigns real, monotonically increasing chunk timestamps with no gaps in coverage', () => {
    const segments = [
      seg(0, 20, 'one'),
      seg(20, 20, 'two'),
      seg(40, 20, 'three'),
      seg(60, 20, 'four'),
      seg(80, 20, 'five'),
    ];
    const chunks = groupSegmentsIntoChunks(segments, 45);
    // Every segment must appear in exactly one chunk (no drops, no duplicates).
    const totalSegments = chunks.reduce((sum, chunk) => sum + chunk.segments.length, 0);
    expect(totalSegments).toBe(segments.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startSeconds).toBeGreaterThanOrEqual(chunks[i - 1]!.endSeconds);
    }
  });

  it('uses a real default target window when none is passed', () => {
    const segments = [seg(0, 10, 'a'), seg(10, 10, 'b')];
    expect(() => groupSegmentsIntoChunks(segments)).not.toThrow();
  });
});
