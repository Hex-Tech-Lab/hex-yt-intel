/**
 * Route-level fail-closed proof for the remediation webhook (PR #310
 * post-merge review, P2d). The service's fail-closed behavior (a
 * transcripts-query error throws out of findAnalysesWithMissingDimensions →
 * runRemediationHarness) only means something to QStash if the ROUTE
 * surfaces it as a non-2xx response — QStash retries on non-2xx, and a
 * swallowed-to-200 error would make every tick report success while silently
 * skipping the sweep. Pinned here: signature failure → 401, harness throw →
 * 500 (retry-eligible), harness success → 200.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyQStashSignature = vi.hoisted(() => vi.fn());
const runRemediationHarness = vi.hoisted(() => vi.fn());

vi.mock('@/lib/qstash-client', () => ({ verifyQStashSignature }));
vi.mock('@/lib/services/dimension-remediation', () => ({ runRemediationHarness }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { POST } from '@/app/api/webhooks/remediate-dimensions/route';

const postRequest = (): NextRequest =>
  new NextRequest('http://localhost/api/webhooks/remediate-dimensions', {
    method: 'POST',
    body: '{}',
    headers: { 'upstash-signature': 'sig-token' },
  });

describe('POST /api/webhooks/remediate-dimensions (fail-closed to QStash)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the QStash signature does not verify', async () => {
    verifyQStashSignature.mockResolvedValue(false);
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(runRemediationHarness).not.toHaveBeenCalled();
  });

  it('returns 200 with the sweep result on success', async () => {
    verifyQStashSignature.mockResolvedValue(true);
    runRemediationHarness.mockResolvedValue({ scanned: 1, remediated: 1, stillPartial: 0, skipped: 0, errored: 0, budgetExhausted: false, disabled: false });
    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.remediated).toBe(1);
  });

  it('P2d: a thrown harness error (e.g. the fail-closed transcripts query) propagates as 500 so QStash retries, never a swallowed 200', async () => {
    verifyQStashSignature.mockResolvedValue(true);
    runRemediationHarness.mockRejectedValue(new Error('transcripts query failed'));
    const res = await POST(postRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('ERR_REMEDIATION_SWEEP_FAILED');
    expect(body.error).toBe('transcripts query failed');
  });
});
