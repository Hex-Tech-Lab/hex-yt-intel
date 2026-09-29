import { describe, it, expect } from 'vitest';
import {
  validatePriorPayload,
  PriorPayloadSchema,
  PRIOR_PAYLOAD_MAX_BYTES_FALLBACK,
  resolvePriorPayloadMaxBytes,
  PRIOR_PAYLOAD_MAX_BYTES_CEILING,
  fitPriorPayloadToCap,
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
      dimensions: Array.from({ length: 12 }, (_slot, slotIndex) => ({ number: slotIndex + 1, content: 'x' })),
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

describe('fitPriorPayloadToCap (client-side, CodeRabbit #363)', () => {
  const grounded = (chars: number) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 10].map((number) => ({ number, content: 'g'.repeat(chars), extra: { kg: 'x'.repeat(500) } }));

  it('passes an under-cap payload through untouched (only number + content kept)', () => {
    const fitted = fitPriorPayloadToCap(grounded(100), 65536);
    expect(fitted.dimensions).toHaveLength(9);
    expect(fitted.dimensions[0]).toEqual({ number: 1, content: 'g'.repeat(100) });
  });

  it('trims an over-cap payload until the WORKER guard accepts it (dims 9/11 can never be 400d)', () => {
    const fitted = fitPriorPayloadToCap(grounded(20_000), 8192);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(8192);
    expect(fitted.dimensions).toHaveLength(9);
    expect(fitted.dimensions[0]!.content).toContain('[trimmed to fit the grounded-evidence size cap]');
    expect(validatePriorPayload(fitted, { maxBytes: 8192, isProjective: true }).ok).toBe(true);
  });

  it('respects the hard ceiling even when the job asks for more', () => {
    const fitted = fitPriorPayloadToCap(grounded(20_000), 999_999_999);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(PRIOR_PAYLOAD_MAX_BYTES_CEILING);
  });

  it('drops malformed dimensions rather than sending something the worker rejects', () => {
    const fitted = fitPriorPayloadToCap([{ number: 0, content: 'x' }, { number: 3, content: 42 }, { number: 5, content: 'ok' }], 65536);
    expect(fitted.dimensions).toEqual([{ number: 5, content: 'ok' }]);
  });

  it('fits multi-byte (CJK) content by BYTES, not UTF-16 code units, and keeps it non-empty', () => {
    const cjk = [1, 2, 3].map((number) => ({ number, content: '知识图谱'.repeat(2000) }));
    const fitted = fitPriorPayloadToCap(cjk, 4096);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(4096);
    expect(fitted.dimensions.length).toBeGreaterThan(0);
    expect(validatePriorPayload(fitted, { maxBytes: 4096, isProjective: true }).ok).toBe(true);
  });

  it('keeps a fitting subset when even trimmed dimensions overflow a very small cap', () => {
    // 9 trimmed dims cost ~80 bytes each in JSON + trim note, so 400 bytes
    // cannot hold all of them even with empty content.
    const fitted = fitPriorPayloadToCap(grounded(20_000), 400);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(400);
    expect(fitted.dimensions.length).toBeGreaterThan(0);
    expect(fitted.dimensions[0]!.number).toBe(1);
  });

  it('keeps one entry per dimension number (duplicates would otherwise reach the prompt)', () => {
    const fitted = fitPriorPayloadToCap([{ number: 2, content: 'first' }, { number: 2, content: 'second' }], 65536);
    expect(fitted.dimensions).toEqual([{ number: 2, content: 'first' }]);
  });
});

describe('R1e explicitSpeakerResources in prior_payload', () => {
  const dims = [{ number: 1, content: 'grounded apex' }, { number: 8, content: 'kg nodes' }];

  it('schema accepts up to 20 resources of up to 200 chars', () => {
    const ok = validatePriorPayload({ schemaVersion: '2.0', dimensions: dims, explicitSpeakerResources: ['Book A', 'https://example.org'] }, { maxBytes: 65536, isProjective: true });
    expect(ok.ok).toBe(true);
  });

  it('schema rejects 21 resources or a 201-char resource', () => {
    const many = Array.from({ length: 21 }, (_item, index) => `r${index}`);
    expect(validatePriorPayload({ schemaVersion: '2.0', dimensions: dims, explicitSpeakerResources: many }, { maxBytes: 65536, isProjective: true }).ok).toBe(false);
    expect(validatePriorPayload({ schemaVersion: '2.0', dimensions: dims, explicitSpeakerResources: ['x'.repeat(201)] }, { maxBytes: 65536, isProjective: true }).ok).toBe(false);
  });

  it('KEEPS the resources when the whole payload fits (they must reach the projective 8.4 step)', () => {
    const fitted = fitPriorPayloadToCap(dims, 65536, ['Thinking, Fast and Slow', 'Tool X']);
    expect(fitted.explicitSpeakerResources).toEqual(['Thinking, Fast and Slow', 'Tool X']);
    expect(fitted.dimensions).toEqual(dims);
  });

  it('drops resources BEFORE trimming any dimension content when over the cap', () => {
    const bigDims = [{ number: 1, content: 'd'.repeat(900) }];
    const resources = Array.from({ length: 20 }, (_item, index) => `Resource title number ${index} `.padEnd(60, '.'));
    const withoutBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: '2.0', dimensions: bigDims })).length;
    const fitted = fitPriorPayloadToCap(bigDims, withoutBytes + 10, resources);
    expect(fitted.explicitSpeakerResources).toBeUndefined();
    expect(fitted.dimensions[0]!.content).toBe('d'.repeat(900)); // untrimmed
  });
});

