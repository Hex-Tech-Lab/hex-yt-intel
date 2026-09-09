/**
 * Analysis Requeue (ADR 021 Phase 3) — the requeue-partial middle branch.
 *
 * A stuck `processing` row the markdown path would fail may still hold
 * genuinely-persisted dimensions in `analysis_chunks` (Phase 1's
 * `dimensions_covered` checkpoint). decideRequeuePartial decides the NEW
 * middle outcome between the two existing terminal ones: requeue (keep the
 * row in `processing`, record exactly which dimensions are missing, burn one
 * remediation retry) instead of finalize-with-whatever's-there or discard.
 * The two existing paths' semantics must NOT change — the null-return cases
 * below are explicit regression guards for that.
 *
 * The sweep-level wiring (reaper loop → tryRequeuePartial → guarded write)
 * is exercised in analysis-reaper.test.ts — this file covers the pure
 * decision + patch-builder contracts.
 */
import { describe, it, expect } from 'vitest';
import { decideRequeuePartial, buildRequeuePatch, MIN_SALVAGEABLE_DIMENSIONS } from '@/lib/services/analysis-requeue';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

describe('decideRequeuePartial (ADR 021 Phase 3)', () => {
  const MAX_RETRIES = 3;

  it('requeues a stuck row with some (3/11) dimensions covered while retries remain', () => {
    const decision = decideRequeuePartial([1, 2, 3], 1, MAX_RETRIES);
    expect(decision).not.toBeNull();
    expect(decision!.outcome).toBe('requeue-partial');
    expect(decision!.missingDimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('still fails (null) a stuck row with 0/11 dimensions covered — unchanged behavior', () => {
    expect(decideRequeuePartial([], 0, MAX_RETRIES)).toBeNull();
  });

  it('still fails (null) when the retry ceiling is already hit — the ceiling must actually gate requeue', () => {
    expect(decideRequeuePartial([1, 2, 3], MAX_RETRIES, MAX_RETRIES)).toBeNull();
    // An overrun (e.g. a double-increment race) must be gated just as hard.
    expect(decideRequeuePartial([1, 2, 3], MAX_RETRIES + 1, MAX_RETRIES)).toBeNull();
  });

  it('still finalizes (null) a row already meeting MIN_SALVAGEABLE_DIMENSIONS — existing salvage path unchanged', () => {
    const covered = Array.from({ length: MIN_SALVAGEABLE_DIMENSIONS }, (_ignored, index) => index + 1);
    expect(decideRequeuePartial(covered, 0, MAX_RETRIES)).toBeNull();
  });

  it('dedupes the covered set — duplicate covered numbers must not inflate the count', () => {
    const decision = decideRequeuePartial([3, 3, 1], 0, MAX_RETRIES);
    expect(decision).not.toBeNull();
    expect(decision!.missingDimensions).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('ignores out-of-range covered numbers — only 1..TOTAL_DIMENSIONS count as covered', () => {
    const decision = decideRequeuePartial([0, 12, 99, 1], 0, MAX_RETRIES);
    expect(decision).not.toBeNull();
    expect(decision!.missingDimensions).not.toContain(1);
    expect(decision!.missingDimensions).toHaveLength(TOTAL_DIMENSIONS - 1);
  });
});

/**
 * buildRequeuePatch — the requeue bookkeeping write. Same SettlePatch shape
 * as buildSettlePatch, but it is NOT a settle: billing_status stays
 * `processing` (the row must remain sweepable for the retry window / future
 * Phase 4 selective dispatch), and the report records the specific missing
 * dimensions plus the incremented shared `remediation_retry_count` — with no
 * `reaped` markers, since nothing was settled.
 */
describe('buildRequeuePatch (ADR 021 Phase 3)', () => {
  const nowIso = '2026-09-09T00:00:00.000Z';

  it('keeps the row in processing and records missing dimensions + incremented retry count', () => {
    const { outcome, patch } = buildRequeuePatch([4, 5], { persona: 'p1', status: 'processing', remediation_retry_count: 1 }, 2, nowIso);
    expect(outcome).toBe('requeue-partial');
    expect(patch.billing_status).toBe('processing');
    expect(patch.validation_passed).toBe(false);
    expect(patch.updated_at).toBe(nowIso);
    expect(patch.validation_report).toMatchObject({
      persona: 'p1',
      status: 'partial',
      requeue_partial: true,
      requeue_missing_dimensions: [4, 5],
      requeued_at: nowIso,
      remediation_retry_count: 2,
    });
  });

  it('never writes reaped markers — a requeue is not a terminal reap', () => {
    const { patch } = buildRequeuePatch([4], null, 1, nowIso);
    expect(patch.validation_report).not.toHaveProperty('reaped');
    expect(patch.validation_report).not.toHaveProperty('reaped_at');
    expect(patch.validation_report).not.toHaveProperty('reaped_via');
  });

  it('tolerates a non-plain-object (array) prior report instead of spreading it', () => {
    const { patch } = buildRequeuePatch([4], ['unexpected'], 1, nowIso);
    expect(patch.validation_report).toMatchObject({ status: 'partial', requeue_partial: true, remediation_retry_count: 1 });
    expect(Array.isArray(patch.validation_report)).toBe(false);
  });
});
