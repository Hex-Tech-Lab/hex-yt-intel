import { describe, it, expect } from 'vitest';
import {
  validatePriorPayload,
  PriorPayloadSchema,
  PRIOR_PAYLOAD_MAX_BYTES_FALLBACK,
  resolvePriorPayloadMaxBytes,
  PRIOR_PAYLOAD_MAX_BYTES_CEILING,
} from './prior-payload';

/**
 * R1d (2026-09-29): boundary guard contract tests for prior_payload.
 * The schema lives in web/lib/config/prior-payload.ts (shared module)
 * because the worker workspace has no vitest harness of its own
 * (ledger 2026-09-28); the worker's routes/analysis.ts imports and
 * enforces the same function at the /analyze-llm-stream boundary.
 */

const validPayload = {
  schemaVersion: '2.0',
  dimensions: [
    { number: 1, content: 'grounded dimension one' },
    { number: 10, content: 'grounded dimension ten', extraPassthrough: 'dropped' },
  ],
};

describe('PriorPayloadSchema', () => {
  it('accepts a valid payload', () => {
    expect(PriorPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects a 12th dimension (max 11)', () => {
    const payload = {
      schemaVersion: '2.0',
      dimensions: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, content: 'x' })),
    };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects dimension number 0', () => {
    const payload = { schemaVersion: '2.0', dimensions: [{ number: 0, content: 'x' }] };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects dimension number 12', () => {
    const payload = { schemaVersion: '2.0', dimensions: [{ number: 12, content: 'x' }] };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a non-integer dimension number', () => {
    const payload = { schemaVersion: '2.0', dimensions: [{ number: 1.5, content: 'x' }] };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an extra root key (strict)', () => {
    const payload = { ...validPayload, attackerKey: 'inject' };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const payload = { ...validPayload, schemaVersion: '1.0' };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a missing content field', () => {
    const payload = { schemaVersion: '2.0', dimensions: [{ number: 1 }] };
    expect(PriorPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('validatePriorPayload', () => {
  it('accepts a valid payload on a projective bundle and drops passthrough keys', () => {
    const verdict = validatePriorPayload(validPayload, { maxBytes: PRIOR_PAYLOAD_MAX_BYTES_FALLBACK, isProjective: true });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.dimensions).toEqual([
        { number: 1, content: 'grounded dimension one' },
        { number: 10, content: 'grounded dimension ten' },
      ]);
    }
  });

  it('rejects any payload on a grounded bundle (dropped, not a 400)', () => {
    const verdict = validatePriorPayload(validPayload, { maxBytes: PRIOR_PAYLOAD_MAX_BYTES_FALLBACK, isProjective: false });
    expect(verdict).toEqual({ ok: false, reason: 'grounded_bundle_rejects_prior_payload' });
  });

  it('rejects a payload over the byte cap', () => {
    const big = {
      schemaVersion: '2.0',
      dimensions: [{ number: 1, content: 'x'.repeat(PRIOR_PAYLOAD_MAX_BYTES_FALLBACK) }],
    };
    const verdict = validatePriorPayload(big, { maxBytes: PRIOR_PAYLOAD_MAX_BYTES_FALLBACK, isProjective: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('exceeds_max_bytes');
  });

  it('accepts a payload just under the byte cap', () => {
    const content = 'x'.repeat(PRIOR_PAYLOAD_MAX_BYTES_FALLBACK - 200);
    const nearCap = { schemaVersion: '2.0', dimensions: [{ number: 1, content }] };
    const verdict = validatePriorPayload(nearCap, { maxBytes: PRIOR_PAYLOAD_MAX_BYTES_FALLBACK, isProjective: true });
    expect(verdict.ok).toBe(true);
  });

  it('rejects schema violations with the schema reason (HTTP 400 path)', () => {
    const verdict = validatePriorPayload({ schemaVersion: '2.0', dimensions: [] }, { maxBytes: 65536, isProjective: true });
    // Empty dimensions array is structurally valid per schema; use an invalid one instead.
    const bad = validatePriorPayload({ schemaVersion: '9.9', dimensions: [] }, { maxBytes: 65536, isProjective: true });
    expect(verdict.ok).toBe(true);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('schema_violation');
  });
});

describe('resolvePriorPayloadMaxBytes (unsigned client value)', () => {
  it('never lets a forged request raise the cap above the hard ceiling', () => {
    expect(resolvePriorPayloadMaxBytes(999_999_999)).toBe(PRIOR_PAYLOAD_MAX_BYTES_CEILING);
  });
  it('lets the registry lower the cap', () => {
    expect(resolvePriorPayloadMaxBytes(4096)).toBe(4096);
  });
  it('falls back (still clamped) on missing, zero, negative or non-numeric values', () => {
    for (const v of [undefined, 0, -1, 'abc', Number.NaN]) {
      expect(resolvePriorPayloadMaxBytes(v)).toBeLessThanOrEqual(PRIOR_PAYLOAD_MAX_BYTES_CEILING);
      expect(resolvePriorPayloadMaxBytes(v)).toBeGreaterThan(0);
    }
  });
});
