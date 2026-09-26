/**
 * Transcript chain-budget tests (review P2, 2026-09-26) — split from
 * SupadataTranscriptProvider.test.ts to keep each file under the 500-line
 * qa-intel rule. Verifies the DEFAULT_CHAIN_BUDGET_MS derivation covers
 * every tier's enforced worst case, including Supadata's 180s window
 * (native probe + generate, each 30s initial + 60s jobId-anchored job
 * window), with a negative control proving the test fails under the old
 * 250000ms default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptExtractor } from '../services/TranscriptExtractor';

vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe('Chain budget covers every tier worst case (review P2, 2026-09-26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Reconciled (OC-B, 2026-09-26) to the jobId-anchored poll-window model:
  // Supadata's enforced worst case is now 180s (native probe 30s initial +
  // 60s job window, then generate 30s + 60s), so the corrected default budget
  // is 435000ms (225s earlier tiers + 180s Supadata + 30s slack). The mock consumes
  // its full reserved window (180000). The 30s slack ensures the provider settles
  // strictly before the budget timer.
  it('default budget (435000ms) lets Supadata run its full 180s window after all four earlier tiers hit their worst case', async () => {
    vi.useFakeTimers();
    const tierDelays: Array<[string, number]> = [['transcriptapi', 30000], ['apify', 130000], ['decodo', 30000], ['native', 35000]];
    let supadataCalled = false;
    const extractor = new TranscriptExtractor(undefined, undefined, undefined, undefined, undefined, undefined, 'sd-key', 60);
    (extractor as any).buildProviders = () => [
      ...tierDelays.map(([name, delay]) => ({
        name,
        provider: { fetch: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${name} down`)), delay)) },
      })),
      {
        name: 'supadata' as const,
        // The Supadata mock CONSUMES its full 180s reserved window before
        // resolving: an instant-resolve mock cannot distinguish a 435s budget
        // from a starved 250s one — under 250s the tier would only have 25s
        // left and MUST be budget-aborted.
        provider: { fetch: () => { supadataCalled = true; return new Promise(resolve => setTimeout(() => resolve({ videoId: 'VALID_ID_12', transcript: 'late but present', language: 'en' }), 180000)); } },
      },
    ];
    let attempt: Promise<{ videoId: string; transcript: string; language: string }>;
    try {
      attempt = extractor.fetch('VALID_ID_12');
    } finally {
      vi.unstubAllGlobals();
    }
    // Advance past the four earlier tiers' worst cases (225s) AND Supadata's
    // consumed window (180s) → 405s total, inside the 435s default budget.
    await vi.advanceTimersByTimeAsync(405000);
    const result = await attempt;
    expect(supadataCalled).toBe(true);
    expect(result.transcript).toBe('late but present');
  });

  // Negative control: under the OLD 250000ms budget the earlier tiers' 225s
  // of worst-case deadlines leave Supadata only 25s of its 180s window, so an
  // attempt that needs its full window is budget-aborted and the chain falls
  // to the placeholder. If the 435000 default ever regresses to 250000, the
  // main test above flips to this same placeholder outcome and fails.
  it('negative control: with the OLD 250000ms budget a full-window Supadata attempt is starved', async () => {
    vi.useFakeTimers();
    const tierDelays: Array<[string, number]> = [['transcriptapi', 30000], ['apify', 130000], ['decodo', 30000], ['native', 35000]];
    const extractor = new TranscriptExtractor(undefined, undefined, undefined, undefined, 250000, undefined, 'sd-key', 60);
    (extractor as any).buildProviders = () => [
      ...tierDelays.map(([name, delay]) => ({
        name,
        provider: { fetch: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${name} down`)), delay)) },
      })),
      {
        name: 'supadata' as const,
        provider: { fetch: () => new Promise(resolve => setTimeout(() => resolve({ videoId: 'VALID_ID_12', transcript: 'too late', language: 'en' }), 179000)) },
      },
    ];
    let attempt: Promise<{ videoId: string; transcript: string; language: string }>;
    try {
      attempt = extractor.fetch('VALID_ID_12');
    } finally {
      vi.unstubAllGlobals();
    }
    await vi.advanceTimersByTimeAsync(251000);
    const result = await attempt;
    // Budget aborts Supadata 25s into its 180s window → placeholder answers.
    expect(result.transcript).toBe('[Transcript unavailable for this video - content ingestion failed across all available sources]');
  });
});
