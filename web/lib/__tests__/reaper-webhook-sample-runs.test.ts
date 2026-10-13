/**
 * T12c wiring: the QStash reaper tick must run sweepStaleSampleRuns after the
 * analysis sweep, only after the signature check, and a sample-run sweep failure
 * must not discard the analysis sweep result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyQStashSignature = vi.hoisted(() => vi.fn());
const sweepStuckAnalyses = vi.hoisted(() => vi.fn());
const sweepStaleSampleRuns = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/qstash-client', () => ({ verifyQStashSignature }));
vi.mock('@/lib/services/analysis-reaper', () => ({ sweepStuckAnalyses }));
vi.mock('@/lib/services/sample-run-sweep', () => ({ sweepStaleSampleRuns }));

import { POST } from '@/app/api/webhooks/reaper/route';

const req = () =>
  new Request('http://localhost/api/webhooks/reaper', { method: 'POST', headers: { 'upstash-signature': 's' }, body: '{}' }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  verifyQStashSignature.mockResolvedValue(true);
  sweepStuckAnalyses.mockResolvedValue({ reaped: 2 });
  sweepStaleSampleRuns.mockResolvedValue({ requeued: 1, failedPending: 0, failedSampling: 3, errors: 0 });
});

describe('reaper webhook runs the sample-run sweep', () => {
  it('runs both sweeps and returns the sample-run stats', async () => {
    const res = await POST(req());
    const body = await res.json();
    expect(sweepStuckAnalyses).toHaveBeenCalledTimes(1);
    expect(sweepStaleSampleRuns).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ ok: true, reaped: 2, sampleRuns: { requeued: 1, failedSampling: 3 } });
  });

  it('negative control: bad signature -> 401 and NEITHER sweep runs', async () => {
    verifyQStashSignature.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(sweepStuckAnalyses).not.toHaveBeenCalled();
    expect(sweepStaleSampleRuns).not.toHaveBeenCalled();
  });

  it('a sample-run sweep failure is captured and does not discard the analysis sweep result', async () => {
    sweepStaleSampleRuns.mockRejectedValue(new Error('db down'));
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, reaped: 2, sampleRuns: null });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
