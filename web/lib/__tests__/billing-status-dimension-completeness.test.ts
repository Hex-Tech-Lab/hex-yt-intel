import { describe, it, expect } from 'vitest';
import { buildDimensionStatus, extractDimensionStatus, resolveBillingStatus } from '@/lib/services/stitch-analysis-chunks';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/**
 * Regression tests for the billing_status='failed' bug on complete analyses.
 *
 * Bug (2026-08-03): When UCISPayloadV2Schema.safeParse failed on KG-node or
 * persona metadata fields, persist/route.ts Path 1 forced billing_status='failed'
 * via `isStitchedValid ? billingStatus : 'failed'`, ignoring buildDimensionStatus's
 * independently-computed 'completed' (which correctly inspects dimension presence).
 *
 * Fix: Line 607 changed to `billing_status: cancelled ? 'cancelled' : billingStatus`
 * (mirrors Path 2's correct semantics at persist/route.ts:841).
 *
 * Confirmed example: analysis 47cf53d3-f749-40ba-b3e2-f7abdd4644d7
 * (video wcgvQs_9Yx8) — all 11 dimension_status entries "done" but
 * top-level billing_status was 'failed', making it permanently invisible
 * to the reaper (which only sweeps billing_status='processing').
 *
 * NOTE: stitchChunksIntoPayload assembles dimensions as an Array (cleanDimensions),
 * NOT as the Record<number,UCISDimension> shape in the persisted UCISPayloadV2 type.
 * extractDimensionStatus operates on the stitched (array) form.
 */

/** Build a stitched payload shape with N complete dimensions as an array. */
function makeStitchedPayload(dimensionCount: number): any {
  const dimensions = Array.from({ length: dimensionCount }, (_, i) => ({
    number: i + 1,
    name: `Dimension ${i + 1}`,
    content: `Content for dimension ${i + 1}. `.repeat(5),
  }));
  return {
    schemaVersion: '2.0',
    dimensions, // Array form — matches what stitchChunksIntoPayload produces
    knowledgeGraph: { nodes: [], edges: [] },
    persona: { primary: { id: 'researcher', label: 'Researcher', weight: 1.0 }, cognitiveLenses: ['lens'], selectionRationale: 'Test' },
  };
}

describe('buildDimensionStatus — billing_status regression (2026-08-03)', () => {
  it('returns billingStatus="completed" when all TOTAL_DIMENSIONS are present', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus, validationStatus, completeness, dimensionStatus } =
      buildDimensionStatus(payload);

    expect(billingStatus).toBe('completed');
    expect(validationStatus).toBe('done');
    expect(completeness).toBe(1);
    expect(dimensionStatus).toHaveLength(TOTAL_DIMENSIONS);
    expect(dimensionStatus.every(d => d.status === 'done')).toBe(true);
  });

  it('returns billingStatus="failed" when fewer than TOTAL_DIMENSIONS are present', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS - 1);
    const { billingStatus, validationStatus, completeness } =
      buildDimensionStatus(payload);

    expect(billingStatus).toBe('failed');
    expect(validationStatus).toBe('partial');
    expect(completeness).toBeLessThan(1);
  });

  it('returns billingStatus="failed" when no dimensions are present', () => {
    const payload = makeStitchedPayload(0);
    const { billingStatus, validationStatus, completeness } =
      buildDimensionStatus(payload);

    expect(billingStatus).toBe('failed');
    expect(validationStatus).toBe('failed');
    expect(completeness).toBe(0);
  });

  it('returns billingStatus="failed" for null payload (no content at all)', () => {
    const { billingStatus, validationStatus } = buildDimensionStatus(null);
    expect(billingStatus).toBe('failed');
    expect(validationStatus).toBe('failed');
  });

  /**
   * THE KEY REGRESSION TEST:
   *
   * Simulates the exact scenario that caused analysis 47cf53d3 to be stuck:
   * - stitchChunksIntoPayload returns validationPassed=false (KG/persona schema failure)
   * - BUT the stitched payload has all TOTAL_DIMENSIONS present in its array
   *
   * Before the fix (persist/route.ts:607):
   *   billing_status: isStitchedValid ? billingStatus : 'failed'
   *   => 'failed' (wrong — discards usable content, invisible to reaper which
   *      only sweeps billing_status='processing')
   *
   * After the fix:
   *   billing_status: cancelled ? 'cancelled' : billingStatus
   *   => 'completed' (correct — mirrors Path 2's semantics at persist/route.ts:841)
   */
  it('REGRESSION: resolveBillingStatus returns "completed" even when isStitchedValid=false and all dimensions present', () => {
    // Represents the stitchedPayload returned when UCISPayloadV2Schema.safeParse
    // fails on KG-node/persona fields — payload is fully populated, schema
    // failure is on cosmetic metadata, NOT on dimension content.
    const stitchedPayloadWithSchemaFailure = makeStitchedPayload(TOTAL_DIMENSIONS);

    const { billingStatus, dimensionStatus } =
      buildDimensionStatus(stitchedPayloadWithSchemaFailure);

    // buildDimensionStatus sees all dimensions present → 'completed'.
    expect(billingStatus).toBe('completed');
    expect(dimensionStatus.filter(d => d.status === 'done')).toHaveLength(TOTAL_DIMENSIONS);

    // resolveBillingStatus is the real helper now used in persist/route.ts.
    // A revert of the fix would change this helper's body — this test would fail.
    expect(resolveBillingStatus(false, billingStatus)).toBe('completed');
    expect(resolveBillingStatus(true, billingStatus)).toBe('cancelled');
  });

  it('cancelled=true always produces "cancelled" regardless of dimension completeness', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus } = buildDimensionStatus(payload);
    // Use the real helper — not an inline ternary
    expect(resolveBillingStatus(true, billingStatus)).toBe('cancelled');
    expect(resolveBillingStatus(false, billingStatus)).toBe('completed');
  });
});

describe('extractDimensionStatus — dimension presence detection', () => {
  it('marks all N dimensions "done" when all are in the payload', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const statuses = extractDimensionStatus(payload);

    expect(statuses).toHaveLength(TOTAL_DIMENSIONS);
    statuses.forEach((s, idx) => {
      expect(s.dimension).toBe(idx + 1);
      expect(s.status).toBe('done');
      expect(s.completedAt).toBeDefined();
    });
  });

  it('marks missing dimensions "timeout" when some are absent', () => {
    const payload = makeStitchedPayload(5);
    const statuses = extractDimensionStatus(payload);

    expect(statuses).toHaveLength(TOTAL_DIMENSIONS);
    statuses.forEach((s, idx) => {
      const dimNum = idx + 1;
      if (dimNum <= 5) {
        expect(s.status).toBe('done');
      } else {
        expect(s.status).toBe('timeout');
        expect(s.error).toMatch(/not available/i);
      }
    });
  });

  it('marks all dimensions "timeout" for null payload', () => {
    const statuses = extractDimensionStatus(null);
    expect(statuses).toHaveLength(TOTAL_DIMENSIONS);
    expect(statuses.every(s => s.status === 'timeout')).toBe(true);
  });
});

/**
 * Cache-write gate tests (Item 2, 2026-08-03).
 *
 * The cache gate in persist/route.ts Path 1 was `if (isStitchedValid)`.
 * After the billing fix, isStitchedValid=false + billingStatus='completed'
 * is reachable (schema failure on KG/persona metadata, all dimensions present).
 *
 * The fixed gate is `if (billingStatus === 'completed')`.
 *
 * These tests model the decision predicate. The actual setAnalysisCache call
 * lives inside the POST handler (integration-tested via Playwright / E2E);
 * these unit tests validate the gate predicate logic using the same exported
 * helpers the handler now uses — ensuring a regression in either helper
 * immediately breaks this test file.
 */
describe('cache-write gate — billingStatus controls caching, not isStitchedValid', () => {
  it('CACHE: isStitchedValid=true + billingStatus="completed" → should cache (happy path)', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus } = buildDimensionStatus(payload);
    const isStitchedValid = true;

    // Old gate: if (isStitchedValid) → true ✓
    // New gate: if (billingStatus === 'completed') → true ✓
    expect(isStitchedValid).toBe(true);
    expect(billingStatus).toBe('completed');
    expect(billingStatus === 'completed').toBe(true); // new gate fires
  });

  it('CACHE: isStitchedValid=false + billingStatus="completed" → should cache (the fixed scenario)', () => {
    // This is the exact scenario that was broken before the fix:
    // UCISPayloadV2Schema.safeParse fails (isStitchedValid=false) but all
    // dimensions are present (billingStatus='completed').
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus } = buildDimensionStatus(payload);
    const isStitchedValid = false; // schema failure on KG/persona metadata

    // Old gate: if (isStitchedValid) → false ✗ (SKIPPED cache — ADR Law #1 violation)
    // New gate: if (billingStatus === 'completed') → true ✓ (caches correctly)
    expect(isStitchedValid).toBe(false);
    expect(billingStatus).toBe('completed');
    expect(billingStatus === 'completed').toBe(true); // new gate fires correctly
    expect(isStitchedValid).toBe(false);              // old gate would have skipped
  });

  it('CACHE: isStitchedValid=false + billingStatus="failed" → should NOT cache (incomplete)', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS - 3); // 3 dimensions missing
    const { billingStatus } = buildDimensionStatus(payload);
    const isStitchedValid = false;

    // Old gate: if (isStitchedValid) → false ✗ (skipped — correct for this case)
    // New gate: if (billingStatus === 'completed') → false ✗ (skipped — still correct)
    expect(billingStatus).toBe('failed');
    expect(billingStatus === 'completed').toBe(false); // new gate correctly skips
  });

  it('CACHE: cancelled=true rows are never billed-complete, so should not cache', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus: rawBillingStatus } = buildDimensionStatus(payload);
    const cancelled = true;
    const finalBillingStatus = resolveBillingStatus(cancelled, rawBillingStatus);

    // resolveBillingStatus returns 'cancelled', not 'completed'
    expect(finalBillingStatus).toBe('cancelled');
    expect(finalBillingStatus === 'completed').toBe(false); // gate correctly skips
  });

  it('CACHE: resolveBillingStatus helper used by gate preserves completed for not-cancelled', () => {
    const payload = makeStitchedPayload(TOTAL_DIMENSIONS);
    const { billingStatus } = buildDimensionStatus(payload);

    // Route uses: if (billingStatus === 'completed') where billingStatus = resolveBillingStatus(...)
    // Confirm the helper preserves 'completed' when not cancelled
    const resolved = resolveBillingStatus(false, billingStatus);
    expect(resolved).toBe('completed');
    expect(resolved === 'completed').toBe(true); // gate fires
  });
});
