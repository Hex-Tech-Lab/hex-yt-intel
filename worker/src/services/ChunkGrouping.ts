import type { TranscriptSegment } from '../ports/TranscriptProviderPort';

/**
 * ADR 026 §4.1 (docs/private/ADR_026_GROUNDED_ENTITY_EXTRACTION_2026-08-09.md):
 * group whole consecutive caption segments into chunks for grounded entity
 * extraction. YouTube's ASR captions are already phrase/pause-boundary
 * aligned, so no segment is ever split and no overlap is needed -- this is
 * NOT the fixed-character-window chunking this ADR explicitly rejected.
 */

export interface GroundedChunk {
  chunkId: string;
  text: string;
  /** Real start timestamp (seconds) of the first segment in this chunk. */
  startSeconds: number;
  /** Real end timestamp (seconds) of the last segment in this chunk. */
  endSeconds: number;
  segments: TranscriptSegment[];
}

const DEFAULT_TARGET_WINDOW_SECONDS = 75;

/**
 * Groups consecutive segments into chunks up to targetWindowSeconds (soft
 * ceiling, not an exact cut). Closes the current chunk the moment the next
 * segment would push its span past the target, then starts a new chunk with
 * that segment -- a segment is never split across two chunks.
 *
 * Precondition: `segments` should already be in chronological (`start`
 * ascending) order, as `TranscriptExtractor`'s real output always is
 * (verified: both extraction paths build segments by iterating captions in
 * order and filter to `start >= 0 && duration > 0`). Defensively sorted here
 * anyway (cheap for a per-video segment list) so a caller that violates the
 * precondition gets a still-correct grouping instead of non-monotonic chunk
 * timestamps.
 */
export function groupSegmentsIntoChunks(
  segments: TranscriptSegment[],
  targetWindowSeconds: number = DEFAULT_TARGET_WINDOW_SECONDS
): GroundedChunk[] {
  if (segments.length === 0) return [];
  // A non-positive or non-finite (Infinity/NaN) window falls back to the
  // default rather than throwing or degrading to one-chunk-per-segment --
  // this is a soft target, not a hard contract callers must get exactly right.
  const effectiveWindowSeconds =
    Number.isFinite(targetWindowSeconds) && targetWindowSeconds > 0
      ? targetWindowSeconds
      : DEFAULT_TARGET_WINDOW_SECONDS;

  const orderedSegments = [...segments].sort((segmentA, segmentB) => segmentA.start - segmentB.start);

  const chunks: GroundedChunk[] = [];
  let current: TranscriptSegment[] = [];
  let chunkIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    chunks.push({
      chunkId: `chunk-${chunkIndex}`,
      text: current.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
      startSeconds: first.start,
      endSeconds: last.start + last.duration,
      segments: [...current],
    });
    chunkIndex += 1;
    current = [];
  };

  for (const segment of orderedSegments) {
    if (current.length > 0) {
      const chunkStart = current[0]!.start;
      const wouldBeSpan = segment.start + segment.duration - chunkStart;
      if (wouldBeSpan > effectiveWindowSeconds) {
        flush();
      }
    }
    current.push(segment);
  }
  flush();

  return chunks;
}
