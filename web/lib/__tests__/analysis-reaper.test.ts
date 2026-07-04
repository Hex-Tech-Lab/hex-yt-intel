/**
 * Analysis Reaper — salvage-vs-fail decision.
 * The reaper settles stuck `processing` rows: rows with enough generated
 * dimensions are salvaged to `completed`, the rest are `failed`.
 */
import { describe, it, expect } from 'vitest';
import { decideReapOutcome, buildSettlePatch, MIN_SALVAGEABLE_DIMENSIONS } from '@/lib/services/analysis-reaper';

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

  it('marks a full analysis complete + validation_passed', () => {
    const md = Array.from({ length: 11 }, (_, i) => `### DIMENSION ${i + 1}: X\n\nbody`).join('\n\n');
    const { outcome, patch } = buildSettlePatch(md, null, nowIso);
    expect(outcome).toBe('completed');
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
