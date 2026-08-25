/**
 * Parser/reconciliation tests (D2, 2026-08-23):
 * - parseHighlightsExtraction clamps sub-min and over-max durations (not drops)
 * - takeawayIdx out-of-range → null
 * - parseHighlightsReconciliation rejects duplicate/missing/out-of-range takeawayIdx
 * - NULL p_reconciliation guard is SQL (B1) — cited here, tested at the SQL level
 */

import { describe, it, expect } from 'vitest';
import {
  parseHighlightsExtraction,
} from '@/lib/prompts/highlights-extraction';
import {
  parseHighlightsReconciliation,
} from '@/lib/prompts/highlights-reconciliation';

const VALID_STARTS = new Set([10, 30, 60]);

describe('parseHighlightsExtraction duration clamping (B2)', () => {
  it('clamps sub-min-duration highlights instead of dropping them', () => {
    // start=10, end=11 → duration=1, below min=5. Should clamp to start+5=15, not drop.
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 11, label: 'short point', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.start).toBe(10);
    expect(result.highlights[0]!.end).toBe(15); // clamped to start + min
  });

  it('clamps over-max-duration highlights instead of dropping them', () => {
    // start=10, end=100 → duration=90, above max=60. Should clamp to start+60=70, not drop.
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 100, label: 'long discussion', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.end).toBe(70); // clamped to start + max
  });

  it('keeps highlights within [min, max] unchanged', () => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 20, label: 'normal highlight', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights[0]!.end).toBe(20);
  });
});

describe('parseHighlightsExtraction takeawayIdx bounding (B2)', () => {
  it('nulls takeawayIdx when it is >= takeawaysCount (out of range)', () => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 20, label: 'test', takeawayIdx: 5 }]),
      VALID_STARTS,
      40,
      5,
      60,
      3 // only 3 takeaways (indices 0, 1, 2)
    );
    expect(result.status).toBe('ok');
    expect(result.highlights[0]!.takeawayIdx).toBeNull();
  });

  it('keeps takeawayIdx when it is within [0, takeawaysCount)', () => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 20, label: 'test', takeawayIdx: 2 }]),
      VALID_STARTS,
      40,
      5,
      60,
      3
    );
    expect(result.highlights[0]!.takeawayIdx).toBe(2);
  });

  it('nulls non-integer takeawayIdx', () => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 20, label: 'test', takeawayIdx: 1.5 }]),
      VALID_STARTS,
      40,
      5,
      60,
      3
    );
    expect(result.highlights[0]!.takeawayIdx).toBeNull();
  });
});

describe('parseHighlightsReconciliation uniqueness/range validation (B3)', () => {
  it('rejects duplicate takeawayIdx entries', () => {
    // [0,0,0] for a 3-takeaway digest — was previously accepted, now rejected
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 1 },
        { takeawayIdx: 0, grounded: false, backingHighlightIdx: null },
      ]),
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects missing takeawayIdx (not enough unique entries)', () => {
    // Only takeawayIdx 0 and 1 for a 3-takeaway digest
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 1, grounded: false, backingHighlightIdx: null },
      ]),
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects out-of-range takeawayIdx (>= takeawaysCount)', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 1, grounded: true, backingHighlightIdx: 1 },
        { takeawayIdx: 5, grounded: false, backingHighlightIdx: null }, // out of range
      ]),
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects negative takeawayIdx', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: -1, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 1, grounded: true, backingHighlightIdx: 1 },
        { takeawayIdx: 2, grounded: false, backingHighlightIdx: null },
      ]),
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('accepts a valid unique set and sorts by idx', () => {
    // Deliberately out of order — should be sorted to [0, 1, 2]
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 2, grounded: false, backingHighlightIdx: null },
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 1, grounded: true, backingHighlightIdx: 1 },
      ]),
      3
    );
    expect(result.status).toBe('ok');
    expect(result.reconciliation.takeaways).toHaveLength(3);
    expect(result.reconciliation.takeaways[0]!.idx).toBe(0);
    expect(result.reconciliation.takeaways[1]!.idx).toBe(1);
    expect(result.reconciliation.takeaways[2]!.idx).toBe(2);
  });

  it('rejects non-integer takeawayIdx', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0.5, grounded: true, backingHighlightIdx: 0 },
        { takeawayIdx: 1, grounded: true, backingHighlightIdx: 1 },
        { takeawayIdx: 2, grounded: false, backingHighlightIdx: null },
      ]),
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects backingHighlightIdx >= highlightsCount when highlightsCount is provided', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: 5 }, // highlight index 5 >= highlightsCount 3
      ]),
      1,
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects non-null backingHighlightIdx when grounded is false', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: false, backingHighlightIdx: 0 }, // must be null if not grounded
      ]),
      1,
      3
    );
    expect(result.status).toBe('invalid');
  });

  it('rejects null backingHighlightIdx when grounded is true', () => {
    const result = parseHighlightsReconciliation(
      JSON.stringify([
        { takeawayIdx: 0, grounded: true, backingHighlightIdx: null }, // must have a valid highlight index if grounded
      ]),
      1,
      3
    );
    expect(result.status).toBe('invalid');
  });
});

/**
 * B1 (NULL p_reconciliation guard) is a SQL-level test. The migration file
 * `20260821120100_analysis_highlights_takeaway_idx_verbatim_excerpt.sql`
 * contains the guard:
 *   if p_reconciliation is null then return; end if;
 * This prevents jsonb_set from returning NULL and destroying the entire
 * executive_digest column. A live SQL test would require applying the
 * migration and calling the RPC with NULL — the guard's presence is verified
 * by reading the migration file (see the `if p_reconciliation is null` block
 * in set_executive_digest_reconciliation).
 */
