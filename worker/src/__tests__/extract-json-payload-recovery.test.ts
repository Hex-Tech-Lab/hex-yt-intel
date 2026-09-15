/**
 * Telemetry-accuracy regression test for extractJsonPayload/safeParse
 * (2026-09-15 RCA, Sentry issue HEX-YT-INTEL-3E).
 *
 * The initial JSON.parse failure inside safeParse was captured to Sentry as
 * an ERROR *before* the jsonrepair fallback even ran — so every recoverable
 * mid-document syntax break (the exact shape of HEX-YT-INTEL-3E:
 * finishReason='stop', "Expected ',' or '}' after property value", 18
 * occurrences since 2026-07-24) looked like a data-loss error in Sentry,
 * while the actual recovery ("Recovered via jsonrepair") only logged to
 * console. This test pins the corrected contract:
 *
 * 1. A malformed-but-repairable payload (the HEX-YT-INTEL-3E shape) parses
 *    successfully via jsonrepair and captures NOTHING to Sentry (only a
 *    breadcrumb).
 * 2. An unrecoverable payload returns null and captures exactly one
 *    exception, tagged with the terminal 'jsonrepair_failed' phase and the
 *    initial error message for correlation.
 *
 * The downstream handling of a terminal null (failed-chunk marking +
 * isFullySettled finalize, post-#312) is covered by
 * persist-payloadless-chunk.test.ts on the web side; this file only owns
 * the extraction + telemetry contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractJsonPayload } from '../services/MarkdownReconstructor';
import * as Sentry from '@sentry/cloudflare';

vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// The HEX-YT-INTEL-3E failure shape: valid JSON structure with an
// unescaped double quote inside a string value mid-document — JSON.parse
// throws "Expected ',' or '}' after property value", jsonrepair repairs it.
const REPAIRABLE_TEXT =
  '{"schemaVersion":"2.0","dimensions":[{"number":1,"name":"Apex Intelligence","content":"The video argues that "small bets compound over time" — a core thesis."}]}';

const UNRECOVERABLE_TEXT = '{"schemaVersion":"2.0", {"b": }}';

describe('extractJsonPayload telemetry contract (HEX-YT-INTEL-3E RCA)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recovers a repairable payload via jsonrepair WITHOUT capturing any error to Sentry', () => {
    expect(() => JSON.parse(REPAIRABLE_TEXT)).toThrow(); // precondition: genuinely malformed for JSON.parse
    const parsed = extractJsonPayload(REPAIRABLE_TEXT, 'stop');
    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe('2.0');
    expect(Array.isArray(parsed?.dimensions)).toBe(true);
    expect(parsed?.dimensions?.length).toBe(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const crumb = vi.mocked(Sentry.addBreadcrumb).mock.calls[0][0];
    expect(crumb.message).toContain('jsonrepair');
  });

  it('captures exactly one terminal error (jsonrepair_failed phase) when the payload is unrecoverable', () => {
    const parsed = extractJsonPayload(UNRECOVERABLE_TEXT, 'stop');
    expect(parsed).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const capturedError = vi.mocked(Sentry.captureException).mock.calls[0][0] as Error;
    const context = vi.mocked(Sentry.captureException).mock.calls[0][1] as { contexts: { extractJsonPayload: { phase: string; initialError: string } } };
    expect(context.contexts.extractJsonPayload.phase).toBe('jsonrepair_failed');
    // The initial JSON.parse error is preserved for correlation — a future
    // incident can be joined against the old HEX-YT-INTEL-3E fingerprint.
    expect(typeof context.contexts.extractJsonPayload.initialError).toBe('string');
    expect(capturedError).toBeInstanceOf(Error);
  });
});
