/**
 * CONTRACT: dimension-remediation.ts OpenRouter balance check
 * (getRemainingBudgetCents / fetchKeyInfo).
 *
 * Rewritten 2026-08-06 per Cubic review (PR #211): the previous version
 * re-hardcoded the URL strings and re-implemented the parsing locally,
 * never importing the real functions or mocking fetch -- it could never
 * detect drift. This mocks global.fetch and exercises the REAL exported
 * getRemainingBudgetCents/fetchKeyInfo through their public entry point,
 * covering: primary /key success, primary failure -> legacy /auth/key
 * success, both fail -> 0 (fail-closed), malformed limit_remaining.
 */
import * as Sentry from '@sentry/nextjs';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { openrouterApiKey: 'test-openrouter-key', cloudflareWorkerUrl: 'https://worker.test' } }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { getRemainingBudgetCents, fetchKeyInfo } from './dimension-remediation';

describe('fetchKeyInfo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the given URL with the Bearer auth header and parses data.limit_remaining into cents', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => ({ data: { limit: 100, limit_remaining: 42.5, is_free_tier: false } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const cents = await fetchKeyInfo('https://openrouter.ai/api/v1/key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-openrouter-key');
    expect(cents).toBe(4250);
  });

  it('throws on a malformed (non-numeric) limit_remaining', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: () => ({ data: { limit_remaining: 'not-a-number' } }) } as Response));
    await expect(fetchKeyInfo('https://openrouter.ai/api/v1/key')).rejects.toThrow(/non-numeric limit_remaining/);
  });
});

describe('getRemainingBudgetCents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the documented /api/v1/key endpoint on success, without touching the legacy fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: () => ({ data: { limit_remaining: 10 } }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const cents = await getRemainingBudgetCents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(cents).toBe(1000);
  });

  it('falls back to the legacy /api/v1/auth/key endpoint when the primary fails, and reports the fallback to Sentry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => ({ data: { limit_remaining: 5 } }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const cents = await getRemainingBudgetCents();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(fetchMock.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/auth/key');
    expect(cents).toBe(500);
    // DeepSource finding #4 (fixed): fallback-taken path reports to Sentry
    // even though it "succeeded", so silent dependence on the legacy
    // endpoint doesn't go undetected indefinitely.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('fell back to legacy /auth/key'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('fails closed to 0 cents when BOTH endpoints fail, and reports the terminal failure to Sentry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => ({}) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const cents = await getRemainingBudgetCents();

    expect(cents).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
