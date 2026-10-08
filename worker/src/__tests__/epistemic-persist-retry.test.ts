/**
 * Bounded-retry contract for the Phase C grounded-claims persist (PersistResilienceRule).
 * The attempt budget and backoff delays come from the Settings Registry key
 * `analysis.pipeline.retry.epistemic` via the Vercel-signed grant. The round-trip
 * tests mock the registry, mint the grant, verify it, and run the worker runner
 * with what the grant carried.
 */
import * as Sentry from '@sentry/cloudflare';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { persistGroundedClaims, type EpistemicShadowParams } from '../services/EpistemicShadowRunner';
import { mintEpistemicShadowGrant } from '@/lib/usecases/epistemic-shadow-grant';
import { verifyEpistemicShadowSig, EPISTEMIC_PERSIST_RETRY_DEFAULT, EPISTEMIC_PERSIST_RETRY_KEY, EPISTEMIC_PIPELINE_FLAG_KEY, signEpistemicShadow } from '@/lib/config/epistemic-shadow';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { streamHmacSecret: 'test-secret' } }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: vi.fn() },
}));

const CLAIMS = {
  claims: [],
  unknowns: ['u1'],
  metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
} as unknown as GroundedExtractionPayload;

const ANALYSIS_ID = 'analysis-retry-1';
const SECRET = 'test-secret';

function params(fetchImpl: typeof fetch, persistRetry = EPISTEMIC_PERSIST_RETRY_DEFAULT, sleepImpl = vi.fn().mockResolvedValue(undefined)): EpistemicShadowParams & { sleepImpl: typeof sleepImpl } {
  return {
    analysisId: ANALYSIS_ID,
    videoId: 'v1',
    transcript: '',
    durationSeconds: 60,
    appUrl: 'https://v.example',
    signingSecret: SECRET,
    openRouterApiKey: 'k',
    persistRetry,
    promptBuilder: {} as EpistemicShadowParams['promptBuilder'],
    cascade: {} as EpistemicShadowParams['cascade'],
    fetchImpl,
    sleepImpl,
  };
}

const ok = () => new Response('{}', { status: 200 });
const status = (code: number) => new Response('err', { status: code });
const registry = vi.mocked(SupabaseSettingsAdapter.getRegistrySettings);

/** Registry mock: returns the caller's fallback, overridden by the given values. */
function mockRegistry(overrides: Record<string, unknown>): void {
  registry.mockImplementation((_keys, fallback) => Promise.resolve({ ...fallback, ...overrides } as never));
}

describe('persistGroundedClaims bounded retry (PersistResilienceRule)', () => {
  beforeEach(() => {
    mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a 503 on the first POST is retried with the default backoff and resolves on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok());
    const opts = params(fetchImpl as unknown as typeof fetch);

    await expect(persistGroundedClaims(opts, CLAIMS, false)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(opts.sleepImpl).toHaveBeenCalledTimes(1);
    expect(opts.sleepImpl).toHaveBeenCalledWith(250);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('re-sends the identical signed body on retry (signature is not re-minted)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(500)).mockResolvedValueOnce(ok());
    await persistGroundedClaims(params(fetchImpl as unknown as typeof fetch), CLAIMS, true);
    const first = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body;
    const second = (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body;
    expect(second).toBe(first);
  });

  it('a 500 on every attempt gives up after the default budget with a Sentry report', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(500));
    const opts = params(fetchImpl as unknown as typeof fetch);

    await expect(persistGroundedClaims(opts, CLAIMS, false)).resolves.toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(opts.sleepImpl).toHaveBeenNthCalledWith(1, 250);
    expect(opts.sleepImpl).toHaveBeenNthCalledWith(2, 500);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('a network exception is retried and resolves on a later 200', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok());
    await expect(persistGroundedClaims(params(fetchImpl as unknown as typeof fetch), CLAIMS, false)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a 429 is retried', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok());
    await expect(persistGroundedClaims(params(fetchImpl as unknown as typeof fetch), CLAIMS, false)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a non-retryable 400 is final: one attempt, no backoff', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(400));
    const opts = params(fetchImpl as unknown as typeof fetch);
    await expect(persistGroundedClaims(opts, CLAIMS, false)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(opts.sleepImpl).not.toHaveBeenCalled();
  });

  describe('registry-driven policy (round trip: registry -> signed grant -> runner)', () => {
    it('a registry value of { maxAttempts: 2, backoffDelays: [7] } is minted, verified, and drives the runner', async () => {
      mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true, [EPISTEMIC_PERSIST_RETRY_KEY]: { maxAttempts: 2, backoffDelays: [7] } });
      const grant = await mintEpistemicShadowGrant(ANALYSIS_ID, 'v1');
      expect(grant?.retry).toEqual({ maxAttempts: 2, backoffDelays: [7] });
      await expect(verifyEpistemicShadowSig({ secret: SECRET, analysisId: ANALYSIS_ID, sig: grant!.sig, exp: grant!.exp, retry: grant!.retry })).resolves.toBe(true);

      const fetchImpl = vi.fn().mockResolvedValue(status(500));
      const opts = params(fetchImpl as unknown as typeof fetch, grant!.retry);
      await expect(persistGroundedClaims(opts, CLAIMS, false)).resolves.toBe(false);

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(opts.sleepImpl).toHaveBeenCalledTimes(1);
      expect(opts.sleepImpl).toHaveBeenCalledWith(7);
    });

    it('a registry value with longer backoff (5 attempts, [11, 13, 17, 19]) is honoured by the runner', async () => {
      const custom = { maxAttempts: 5, backoffDelays: [11, 13, 17, 19] };
      mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true, [EPISTEMIC_PERSIST_RETRY_KEY]: custom });
      const grant = await mintEpistemicShadowGrant(ANALYSIS_ID, 'v1');
      const fetchImpl = vi.fn().mockResolvedValue(status(503));
      const opts = params(fetchImpl as unknown as typeof fetch, grant!.retry);

      await expect(persistGroundedClaims(opts, CLAIMS, false)).resolves.toBe(false);

      expect(fetchImpl).toHaveBeenCalledTimes(5);
      expect((opts.sleepImpl as unknown as { mock: { calls: number[][] } }).mock.calls.map((c) => c[0])).toEqual([11, 13, 17, 19]);
    });

    it('an undefined registry key falls back to the 3-attempt / 250ms / 500ms default', async () => {
      mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true });
      const grant = await mintEpistemicShadowGrant(ANALYSIS_ID, 'v1');
      expect(grant?.retry).toEqual({ maxAttempts: 3, backoffDelays: [250, 500] });
    });

    it('a malformed registry value falls back to the default', async () => {
      mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true, [EPISTEMIC_PERSIST_RETRY_KEY]: { maxAttempts: 0, backoffDelays: [] } });
      const grant = await mintEpistemicShadowGrant(ANALYSIS_ID, 'v1');
      expect(grant?.retry).toEqual({ maxAttempts: 3, backoffDelays: [250, 500] });
    });

    it('a policy whose total backoff would outlive the 5-minute claims signature falls back to the default', async () => {
      mockRegistry({ [EPISTEMIC_PIPELINE_FLAG_KEY]: true, [EPISTEMIC_PERSIST_RETRY_KEY]: { maxAttempts: 10, backoffDelays: Array(9).fill(60_000) } });
      const grant = await mintEpistemicShadowGrant(ANALYSIS_ID, 'v1');
      expect(grant?.retry).toEqual({ maxAttempts: 3, backoffDelays: [250, 500] });
    });

    it('a tampered retry policy fails grant verification (the browser cannot raise its own attempts)', async () => {
      const { sig, exp } = await signEpistemicShadow(SECRET, ANALYSIS_ID, { maxAttempts: 2, backoffDelays: [7] });
      await expect(verifyEpistemicShadowSig({ secret: SECRET, analysisId: ANALYSIS_ID, sig, exp, retry: { maxAttempts: 9, backoffDelays: [1, 1, 1, 1, 1, 1, 1, 1] } })).resolves.toBe(false);
    });
  });
});
