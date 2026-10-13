/**
 * sweepStaleSampleRuns (T12c): the three transitions, their conditional-update
 * guards, per-row error containment and the re-enqueue path. The adapter is
 * mocked so each transition's outcome (won / lost the conditional UPDATE) is
 * scripted; the SQL-level WHERE clauses are covered in sample-run-claim-token.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const adapter = vi.hoisted(() => ({
  findPendingRunsForRequeue: vi.fn(),
  findPendingRunsForFailure: vi.fn(),
  findSamplingRunsForFailure: vi.fn(),
  markSampleRunReenqueued: vi.fn(),
  failStaleSampleRun: vi.fn(),
}));
const enqueue = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
const getRegistrySettings = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
vi.mock('@/lib/adapters/SupabaseAuxRemediationAdapter', () => ({ SupabaseAuxRemediationAdapter: adapter }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({ SupabaseSettingsAdapter: { getRegistrySettings } }));
vi.mock('@/lib/services/aux-remediation', () => ({ enqueueInsertedSystemSampleRun: enqueue }));

import { sweepStaleSampleRuns } from '@/lib/services/sample-run-sweep';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const row = (id: string) => ({ id, analysis_id: `an-${id}`, user_id: 'u-1', total_comment_count: 500, reenqueued_at: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getRegistrySettings.mockResolvedValue({
    'comments.sweep.pendingStaleMinutes': 30,
    'comments.sweep.samplingStaleMinutes': 60,
  });
  adapter.findPendingRunsForRequeue.mockResolvedValue([]);
  adapter.findPendingRunsForFailure.mockResolvedValue([]);
  adapter.findSamplingRunsForFailure.mockResolvedValue([]);
  adapter.markSampleRunReenqueued.mockResolvedValue(true);
  adapter.failStaleSampleRun.mockResolvedValue(true);
  enqueue.mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { video_id: 'vid-1' }, error: null });
});

describe('sweepStaleSampleRuns', () => {
  it('uses the registry thresholds to compute the cutoffs for each read', async () => {
    await sweepStaleSampleRuns();
    expect(adapter.findPendingRunsForRequeue).toHaveBeenCalledWith('2026-10-13T11:30:00.000Z', 200);
    expect(adapter.findPendingRunsForFailure).toHaveBeenCalledWith('2026-10-13T11:30:00.000Z', 200);
    expect(adapter.findSamplingRunsForFailure).toHaveBeenCalledWith('2026-10-13T11:00:00.000Z', 200);
  });

  it('transition 1: stale pending is stamped re-enqueued, then enqueued once with its video id', async () => {
    adapter.findPendingRunsForRequeue.mockResolvedValue([row('r1')]);
    const res = await sweepStaleSampleRuns();
    expect(adapter.markSampleRunReenqueued).toHaveBeenCalledWith('r1', NOW.toISOString());
    expect(enqueue).toHaveBeenCalledWith({ analysisId: 'an-r1', userId: 'u-1', videoId: 'vid-1' }, 'r1', 500);
    expect(res).toMatchObject({ requeued: 1, errors: 0 });
  });

  it('transition 1 negative control: a live consumer claimed first (stamp lost) -> NO enqueue, not counted', async () => {
    adapter.findPendingRunsForRequeue.mockResolvedValue([row('r1')]);
    adapter.markSampleRunReenqueued.mockResolvedValue(false);
    const res = await sweepStaleSampleRuns();
    expect(enqueue).not.toHaveBeenCalled();
    expect(res.requeued).toBe(0);
  });

  it('transition 1: an analysis with no video_id is stamped but not enqueued (pass 2 fails it later)', async () => {
    adapter.findPendingRunsForRequeue.mockResolvedValue([row('r1')]);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await sweepStaleSampleRuns();
    expect(enqueue).not.toHaveBeenCalled();
    expect(res.requeued).toBe(0);
  });

  it('transition 2: re-enqueued but still pending is failed with expected=pending', async () => {
    adapter.findPendingRunsForFailure.mockResolvedValue([row('r2')]);
    const res = await sweepStaleSampleRuns();
    expect(adapter.failStaleSampleRun).toHaveBeenCalledWith('r2', 'pending', '2026-10-13T11:30:00.000Z');
    expect(res).toMatchObject({ failedPending: 1, failedSampling: 0 });
  });

  it('transition 3: stale sampling is failed with expected=sampling', async () => {
    adapter.findSamplingRunsForFailure.mockResolvedValue([row('r3')]);
    const res = await sweepStaleSampleRuns();
    expect(adapter.failStaleSampleRun).toHaveBeenCalledWith('r3', 'sampling', '2026-10-13T11:00:00.000Z');
    expect(res).toMatchObject({ failedSampling: 1, failedPending: 0 });
  });

  it('negative control: a finalize that landed first (conditional UPDATE changed 0 rows) is not counted as failed', async () => {
    adapter.findPendingRunsForFailure.mockResolvedValue([row('r2')]);
    adapter.findSamplingRunsForFailure.mockResolvedValue([row('r3')]);
    adapter.failStaleSampleRun.mockResolvedValue(false);
    const res = await sweepStaleSampleRuns();
    expect(res).toEqual({ requeued: 0, failedPending: 0, failedSampling: 0, errors: 0 });
  });

  it('a throwing row is contained: counted + captured, and the remaining rows and passes still run', async () => {
    adapter.findPendingRunsForRequeue.mockResolvedValue([row('r1'), row('r1b')]);
    adapter.markSampleRunReenqueued.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(true);
    adapter.findSamplingRunsForFailure.mockResolvedValue([row('r3')]);
    const res = await sweepStaleSampleRuns();
    expect(res).toEqual({ requeued: 1, failedPending: 0, failedSampling: 1, errors: 1 });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('falls back to 30 minutes when a registry value is unusable (0/NaN)', async () => {
    getRegistrySettings.mockResolvedValue({
      'comments.sweep.pendingStaleMinutes': 0,
      'comments.sweep.samplingStaleMinutes': 'abc',
    });
    await sweepStaleSampleRuns();
    expect(adapter.findPendingRunsForRequeue).toHaveBeenCalledWith('2026-10-13T11:30:00.000Z', 200);
    expect(adapter.findSamplingRunsForFailure).toHaveBeenCalledWith('2026-10-13T11:30:00.000Z', 200);
  });
});
