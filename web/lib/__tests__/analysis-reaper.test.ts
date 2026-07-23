/**
 * Analysis Reaper — salvage-vs-fail decision.
 * The reaper settles stuck `processing` rows: rows with enough generated
 * dimensions are salvaged to `completed`, the rest are `failed`.
 * (billing_status enum: processing | completed | failed -- see
 * web/lib/types/validation-report.ts BillingStatus for the 2026-07-23 RCA on
 * why this is 3 states, not the previous 'pending'|'chargeable'|'charged'|'failed'.)
 */
import { describe, it, expect } from 'vitest';
import { decideReapOutcome, buildSettlePatch, MIN_SALVAGEABLE_DIMENSIONS, chunksAreFullyComplete, type ChunkRow } from '@/lib/services/analysis-reaper';
import { TOTAL_STREAMS } from '@/lib/config/synthesis';

/** Build markdown containing exactly `n` UCIS dimension headers (1..n). */
function markdownWithDimensions(n: number): string {
  return Array.from({ length: n }, (_, i) => `### DIMENSION ${i + 1}: Section ${i + 1}\n\nSome analysis content for dimension ${i + 1}.`).join('\n\n');
}

describe('decideReapOutcome', () => {
  it('fails an empty / null / whitespace analysis (the stuck-with-no-output case)', () => {
    expect(decideReapOutcome(null)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome(undefined)).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('')).toEqual({ outcome: 'failed', dimensionCount: 0 });
    expect(decideReapOutcome('   \n  ')).toEqual({ outcome: 'failed', dimensionCount: 0 });
  });

  it('fails a below-threshold partial (fewer than the salvage minimum)', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS - 1);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS - 1);
    expect(outcome).toBe('failed');
  });

  it('salvages a partial that meets the salvage minimum', () => {
    const md = markdownWithDimensions(MIN_SALVAGEABLE_DIMENSIONS);
    const { outcome, dimensionCount } = decideReapOutcome(md);
    expect(dimensionCount).toBe(MIN_SALVAGEABLE_DIMENSIONS);
    expect(outcome).toBe('completed');
  });

  it('salvages a full 11-dimension analysis', () => {
    const { outcome, dimensionCount } = decideReapOutcome(markdownWithDimensions(11));
    expect(dimensionCount).toBe(11);
    expect(outcome).toBe('completed');
  });
});

describe('buildSettlePatch', () => {
  const nowIso = '2026-07-04T00:00:00.000Z';

  it('fails an empty analysis and preserves prior report fields', () => {
    const { outcome, patch } = buildSettlePatch(null, { persona: 'p1', status: 'processing' }, nowIso);
    expect(outcome).toBe('failed');
    expect(patch.billing_status).toBe('failed');
    expect(patch.validation_passed).toBe(false);
    expect(patch.validation_report).toMatchObject({ persona: 'p1', status: 'failed', reaped: true, reaped_dimensions: 0 });
  });

  // Note: outcome='completed' maps to billing_status='completed'

  it('marks a full analysis complete + validation_passed', () => {
    const md = Array.from({ length: 11 }, (_, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { outcome, patch } = buildSettlePatch(md, null, nowIso);
    expect(outcome).toBe('completed');
    expect(patch.billing_status).toBe('completed');
    expect(patch.validation_passed).toBe(true);
    expect(patch.validation_report.status).toBe('complete');
  });

  it('marks a usable partial completed-but-not-passed (status partial)', () => {
    const md = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { patch } = buildSettlePatch(md, null, nowIso);
    expect(patch.billing_status).toBe('completed');
    expect(patch.validation_passed).toBe(false);
    expect(patch.validation_report.status).toBe('partial');
  });

  it('ignores a non-plain-object (array) prior report instead of spreading it', () => {
    const { patch } = buildSettlePatch(null, ['unexpected'], nowIso);
    expect(patch.validation_report).toMatchObject({ status: 'failed', reaped: true });
    expect(Array.isArray(patch.validation_report)).toBe(false);
  });
});

/**
 * chunksAreFullyComplete — the gate deciding whether the reaper attempts
 * chunk-based recovery (re-stitching a genuinely complete-but-never-
 * finalized analysis) vs. falling through to the markdown-only heuristic.
 *
 * RCA this exists for (2026-07-23 live incident): a stuck analysis had all 5
 * bundle-stream chunks genuinely complete in `analysis_chunks`, but the
 * parent row's own finalize/stitch write was interrupted -- the OLD reaper,
 * blind to analysis_chunks, would eventually have marked a perfectly
 * complete 11/11 analysis 'failed' after the grace window. These tests
 * guard the exact edge cases identified before implementing: TOTAL_STREAMS
 * (bundle count) vs TOTAL_DIMENSIONS (dimension count) confusion, partial
 * chunk sets, and non-'completed' chunk statuses.
 */
describe('chunksAreFullyComplete', () => {
  function makeChunk(index: number, overrides?: Partial<ChunkRow>): ChunkRow {
    return {
      chunk_index: index,
      status: 'completed',
      payload: { dimensions: [{ number: index, name: 'X', content: 'body' }] },
      ...overrides,
    };
  }

  it('is true when all TOTAL_STREAMS chunks are present and completed', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(true);
  });

  it('is false when a chunk is missing (partial set) -- must fall through, not be treated as complete', () => {
    const rows = Array.from({ length: TOTAL_STREAMS - 1 }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when a present chunk has a non-completed status (e.g. interrupted)', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    rows[2] = makeChunk(3, { status: 'interrupted' });
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when a chunk payload has no dimensions array', () => {
    const rows = Array.from({ length: TOTAL_STREAMS }, (_, i) => makeChunk(i + 1));
    rows[0] = makeChunk(1, { payload: { notDimensions: true } });
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false when there are MORE than TOTAL_STREAMS rows (duplicate/corrupt data), not just fewer', () => {
    const rows = Array.from({ length: TOTAL_STREAMS + 1 }, (_, i) => makeChunk(i + 1));
    expect(chunksAreFullyComplete(rows)).toBe(false);
  });

  it('is false for an empty chunk list', () => {
    expect(chunksAreFullyComplete([])).toBe(false);
  });
});
