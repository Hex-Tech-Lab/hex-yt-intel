import { describe, it, expect } from 'vitest';
import { buildFailPatch } from '@/lib/services/analysis-fail-patch';

describe('buildFailPatch', () => {
  it('marks billing_status failed with the given reason', () => {
    const patch = buildFailPatch('Worker stream 3 failed (401)', undefined, '2026-08-15T00:00:00.000Z');
    expect(patch.billing_status).toBe('failed');
    expect(patch.validation_report.reason).toBe('Worker stream 3 failed (401)');
    expect(patch.validation_report.client_reported).toBe(true);
    expect(patch.validation_report.status).toBe('failed');
    expect(patch.updated_at).toBe('2026-08-15T00:00:00.000Z');
  });

  it('falls back to a generic reason when none is given', () => {
    const patch = buildFailPatch(undefined, undefined, '2026-08-15T00:00:00.000Z');
    expect(patch.validation_report.reason).toBe('Client-observed stream failure');
  });

  it('preserves existing report fields instead of overwriting them (P2 fix)', () => {
    const existing = { dimension_status: [{ number: 1, status: 'done' }], model_used: 'claude-haiku-4.5' };
    const patch = buildFailPatch('Network error', existing, '2026-08-15T00:00:00.000Z');
    expect(patch.validation_report.dimension_status).toEqual(existing.dimension_status);
    expect(patch.validation_report.model_used).toBe('claude-haiku-4.5');
    expect(patch.validation_report.status).toBe('failed');
  });

  it('ignores a non-object existing report rather than crashing', () => {
    const patch = buildFailPatch('x', 'not-an-object', '2026-08-15T00:00:00.000Z');
    expect(patch.validation_report.status).toBe('failed');
  });
});
