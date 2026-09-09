/**
 * ADR 021 Phase 2 — presence-check-on-resume.
 *
 * `computeMissingChunkDimensions` is the pure decision core of
 * `getMissingDimensionNumbers`: given the `analysis_chunks` rows for one
 * analysis, which dimension numbers (1..totalDimensions) are NOT yet covered
 * by any successfully-completed chunk.
 *
 * The load-bearing rule (the one most likely to be gotten wrong, and the
 * reason this test exists): a chunk row's `dimensions_covered` is derived by
 * the persist route from the chunk's payload REGARDLESS of that chunk's
 * status (web/app/api/analyses/persist/route.ts derives dimensionsCovered
 * before the status is considered), and an interrupted chunk's payload can
 * come from BracketBuffer.finalize()'s best-effort repair (see ADR 021's
 * Phase 1 Implementation Note) — i.e. a non-completed row can legitimately
 * carry a non-empty dimensions_covered whose dimensions are NOT trustworthy.
 * Only status === 'completed' counts as covered. This mirrors the reaper's
 * own partial-recovery filter (analysis-reaper.ts tryChunkRecovery) and the
 * persist route's FINAL_CHUNK_STATUS check — three independent consumers,
 * one trust rule.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMissingChunkDimensions,
  type ChunkPresenceRow,
} from '@/lib/services/chunk-presence';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

const row = (
  chunk_index: number,
  status: ChunkPresenceRow['status'],
  dimensions_covered: number[] | null
): ChunkPresenceRow => ({ chunk_index, status, dimensions_covered });

const all = (count: number): number[] => Array.from({ length: count }, (unused, index) => index + 1);

describe('computeMissingChunkDimensions', () => {
  it('returns ALL dimensions missing when the chunk journal is null or empty', () => {
    expect(computeMissingChunkDimensions(null, TOTAL_DIMENSIONS)).toEqual(all(TOTAL_DIMENSIONS));
    expect(computeMissingChunkDimensions([], TOTAL_DIMENSIONS)).toEqual(all(TOTAL_DIMENSIONS));
  });

  it('returns exactly the complement of a completed chunk covering a subset', () => {
    const rows = [row(1, 'completed', [1, 2, 3])];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('unions coverage across multiple completed chunks', () => {
    const rows = [row(1, 'completed', [1, 2]), row(2, 'completed', [3, 4])];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual([
      5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('returns [] when completed chunks cover every dimension', () => {
    const rows = [
      row(1, 'completed', all(6)),
      row(2, 'completed', [7, 8, 9, 10, 11]),
    ];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual([]);
  });

  // THE edge case this phase exists for (negative-control target): a
  // failed/interrupted row with a non-empty dimensions_covered must NOT
  // count as coverage — those dimensions still need re-requesting.
  it('does NOT count failed/interrupted chunks as covered even when dimensions_covered is non-empty', () => {
    const rows = [
      row(1, 'interrupted', [1, 2, 3]),
      row(2, 'failed', [4, 5]),
    ];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual(all(TOTAL_DIMENSIONS));
  });

  it('counts dimensions as missing when ONLY failed/interrupted rows exist alongside a completed row covering others', () => {
    const rows = [
      row(1, 'completed', [1, 2, 3]),
      row(2, 'interrupted', [4, 5, 6]),
    ];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('ignores malformed coverage entries (out-of-range, non-integer, null array, duplicates)', () => {
    const rows = [
      row(1, 'completed', [0, 12, 2.5, 3, 3]),
      row(2, 'completed', null),
    ];
    expect(computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS)).toEqual([
      1, 2, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('handles a non-default totalDimensions', () => {
    const rows = [row(1, 'completed', [1, 2, 3])];
    expect(computeMissingChunkDimensions(rows, 5)).toEqual([4, 5]);
  });

  it('returns an ascending, deduplicated list regardless of row order or duplicate coverage', () => {
    const rows = [
      row(2, 'completed', [5, 4]),
      row(1, 'completed', [1, 2, 3]),
      row(3, 'completed', [5]),
    ];
    const result = computeMissingChunkDimensions(rows, TOTAL_DIMENSIONS);
    expect(result).toEqual([6, 7, 8, 9, 10, 11]);
    expect([...result].sort((first, second) => first - second)).toEqual(result);
  });
});
