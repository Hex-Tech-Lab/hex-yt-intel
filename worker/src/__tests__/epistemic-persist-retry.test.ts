/**
 * Bounded-retry contract for the Phase C grounded-claims persist (PersistResilienceRule).
 * A transient 5xx/429 or network error must not drop the ghost row: the same signed
 * body is re-sent with exponential backoff until a 2xx lands or the budget runs out.
 */
import * as Sentry from '@sentry/cloudflare';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { persistGroundedClaims, type EpistemicShadowParams } from '../services/EpistemicShadowRunner';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const CLAIMS = {
  claims: [],
  unknowns: ['u1'],
  metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
} as unknown as GroundedExtractionPayload;

function params(fetchImpl: typeof fetch, sleepImpl = vi.fn().mockResolvedValue(undefined)): EpistemicShadowParams & { sleepImpl: typeof sleepImpl } {
  return {
    analysisId: 'analysis-retry-1',
    videoId: 'v1',
    transcript: '',
    durationSeconds: 60,
    appUrl: 'https://v.example',
    signingSecret: 'test-secret',
    openRouterApiKey: 'k',
    promptBuilder: {} as EpistemicShadowParams['promptBuilder'],
    cascade: {} as EpistemicShadowParams['cascade'],
    fetchImpl,
    sleepImpl,
  };
}

const ok = () => new Response('{}', { status: 200 });
const status = (code: number) => new Response('err', { status: code });

describe('persistGroundedClaims bounded retry (PersistResilienceRule)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a 503 on the first POST is retried with backoff and resolves on the subsequent 200', async () => {
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

  it('a 500 on every attempt backs off exponentially, then gives up with a Sentry report', async () => {
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
});
