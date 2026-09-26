import { NextRequest } from 'next/server';
import { captureException } from '@sentry/nextjs';
import * as nodeCrypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { POST as legacyPOST } from '@/app/api/billing/webhook/route';
import { POST as canonicalPOST } from '@/app/api/webhooks/paddle/route';
import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';
import { acquireRedisLock, releaseRedisLock, getRedisValue, setRedisValue } from '@/lib/redis';

vi.mock('@/lib/redis', () => ({
  acquireRedisLock: vi.fn(),
  releaseRedisLock: vi.fn(),
  getRedisValue: vi.fn(),
  setRedisValue: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const SECRET = 'test-secret';
process.env.PADDLE_WEBHOOK_SECRET = SECRET;

let processSubscriptionEventMock: ReturnType<typeof vi.fn>;

function sign(rawBody: string): string {
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = nodeCrypto.createHmac('sha256', SECRET).update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function eventJson(eventId: string, priceId = 'pri_01m0azkzf40rxr0s09dacy1bqc'): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: 'subscription.created',
    occurred_at: new Date().toISOString(),
    data: { id: 'sub_1', status: 'active', custom_data: { userId: 'user_1' }, items: [{ price: { id: priceId } }] },
  });
}

function post(route: typeof legacyPOST | typeof canonicalPOST, rawBody: string, signature: string | null) {
  const headers = new Headers();
  if (signature !== null) headers.set('paddle-signature', signature);
  return route(new NextRequest('https://hex-yt-intel.vercel.app/api/billing/webhook', {
    method: 'POST',
    body: rawBody,
    headers,
  }));
}

describe('Paddle webhook unification (PR #325 round 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no done marker, lock always acquirable (fresh state).
    vi.mocked(getRedisValue).mockResolvedValue(null);
    vi.mocked(setRedisValue).mockResolvedValue(undefined); // skipcq: JS-0339
    vi.mocked(acquireRedisLock).mockResolvedValue(`tok-${Math.random()}`);
    vi.mocked(releaseRedisLock).mockResolvedValue(undefined); // skipcq: JS-0339
    vi.spyOn(PaddleBillingAdapter.prototype, 'verifySignature').mockReturnValue(true);
    processSubscriptionEventMock = vi.fn().mockResolvedValue({ success: true });
    vi.spyOn(PaddleBillingAdapter.prototype, 'processSubscriptionEvent').mockImplementation(processSubscriptionEventMock);
    vi.spyOn(PaddleBillingAdapter.prototype, 'processTransactionEvent').mockResolvedValue({ success: true });
  });

  it('legacy URL and canonical URL produce identical results for the same signed payload', async () => {
    const rawBody = eventJson('evt_identical');
    const signature = sign(rawBody);

    const legacyRes = await post(legacyPOST, rawBody, signature);
    const canonicalRes = await post(canonicalPOST, rawBody, signature);

    expect(legacyRes.status).toBe(canonicalRes.status);
    expect(await legacyRes.json()).toEqual(await canonicalRes.json());
    expect(legacyRes.status).toBe(200);
  });

  it('duplicate event id is processed once; the re-delivery returns 200 without re-processing (done marker)', async () => {
    const rawBody = eventJson('evt_dup');

    const first = await post(canonicalPOST, rawBody, sign(rawBody));
    // After the first delivery commits, the done marker is present.
    vi.mocked(getRedisValue).mockResolvedValue('1');

    const second = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ message: 'Duplicate event ignored' });
    expect(processSubscriptionEventMock).toHaveBeenCalledTimes(1);
    expect(setRedisValue).toHaveBeenCalledWith('paddle:evt:evt_dup:done', '1', 7 * 24 * 60 * 60);
    expect(releaseRedisLock).toHaveBeenCalledWith('paddle:evt:evt_dup:lock', expect.any(String));
  });

  it('concurrent duplicate while the lock is held returns 409 (never 200)', async () => {
    vi.mocked(getRedisValue).mockResolvedValue(null); // no done marker
    vi.mocked(acquireRedisLock).mockResolvedValue(null); // lock held by another delivery
    const rawBody = eventJson('evt_concurrent');

    const res = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(res.status).toBe(409);
    expect(processSubscriptionEventMock).not.toHaveBeenCalled();
  });

  it('holder crashes (lock released/expired) → retry re-acquires and processes', async () => {
    const rawBody = eventJson('evt_crash');
    vi.mocked(getRedisValue).mockResolvedValue(null); // done marker never written (crash before commit)
    // Lock is free again (TTL expired or compare-and-delete released it).
    vi.mocked(acquireRedisLock).mockResolvedValue('tok-retry');

    const res = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Processed' });
    expect(processSubscriptionEventMock).toHaveBeenCalledTimes(1);
  });

  it('a failed processing attempt releases the lock and returns 5xx so Paddle retries', async () => {
    processSubscriptionEventMock.mockResolvedValue({ success: false, error: 'Unrecognised price ID' });
    const rawBody = eventJson('evt_fail_release');

    const res = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(res.status).toBe(500);
    expect(releaseRedisLock).toHaveBeenCalledWith(
      'paddle:evt:evt_fail_release:lock',
      expect.any(String)
    );
  });

  it('unsigned payload is rejected (401) on BOTH URLs', async () => {
    const rawBody = eventJson('evt_unsigned');

    const legacyRes = await post(legacyPOST, rawBody, null);
    const canonicalRes = await post(canonicalPOST, rawBody, null);

    expect(legacyRes.status).toBe(401);
    expect(canonicalRes.status).toBe(401);
    expect(processSubscriptionEventMock).not.toHaveBeenCalled();
  });

  it('payload with an invalid signature is rejected (401) on BOTH URLs', async () => {
    vi.spyOn(PaddleBillingAdapter.prototype, 'verifySignature').mockReturnValue(false);
    const rawBody = eventJson('evt_badsig');

    const legacyRes = await post(legacyPOST, rawBody, 'ts=1;h1=deadbeef');
    const canonicalRes = await post(canonicalPOST, rawBody, 'ts=1;h1=deadbeef');

    expect(legacyRes.status).toBe(401);
    expect(canonicalRes.status).toBe(401);
    expect(processSubscriptionEventMock).not.toHaveBeenCalled();
  });

  it('Redis unavailable does NOT fail the webhook — processing still runs via the existing updated_at guard', async () => {
    // Degraded mode: the lock helper keeps handing out per-instance tokens
    // (its in-memory fallback), so dedupe rests on the adapter's updated_at
    // guard. The webhook must still process, never 5xx/4xx on lock failure.
    vi.mocked(acquireRedisLock).mockImplementation(() => Promise.resolve(`tok-${Math.random()}`));
    const rawBody = eventJson('evt_redis_down');

    const res = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Processed' });
    expect(processSubscriptionEventMock).toHaveBeenCalledTimes(1);
  });

  it('captures parse/processing errors to Sentry (parity with PaddleBillingAdapter)', async () => {
    vi.spyOn(PaddleBillingAdapter.prototype, 'parseWebhookEvent').mockImplementation(() => {
      throw new Error('malformed json');
    });
    const rawBody = eventJson('evt_parse_error');

    const res = await post(canonicalPOST, rawBody, sign(rawBody));

    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
