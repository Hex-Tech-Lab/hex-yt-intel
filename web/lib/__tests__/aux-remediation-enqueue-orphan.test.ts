/**
 * enqueueSystemCommentSampleRun is now called at every finalize. A run row
 * inserted as 'pending' whose worker enqueue then fails must be marked
 * 'failed', never left orphaned 'pending' (cubic #416 review).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertSystemCommentSampleRun = vi.hoisted(() => vi.fn());
const markSampleRunFailed = vi.hoisted(() => vi.fn());
const hasSystemSampleRun = vi.hoisted(() => vi.fn());
const failStaleSystemSampleRuns = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { cloudflareWorkerUrl: 'https://worker.test', appUrl: 'https://www.getvintel.com' } }));
vi.mock('@/lib/stream-token', () => ({
  signCommentsTier3Token: vi.fn().mockResolvedValue({ sig: 's', exp: 1 }),
  signChannelMetaToken: vi.fn(),
}));
vi.mock('@/lib/adapters', () => ({ SupabasePersistenceAdapter: class {} }));
vi.mock('@/lib/qstash-client', () => ({ publishEmbeddingTask: vi.fn() }));
vi.mock('@/lib/adapters/SupabaseAuxRemediationAdapter', () => ({
  SupabaseAuxRemediationAdapter: { insertSystemCommentSampleRun, markSampleRunFailed, hasSystemSampleRun, failStaleSystemSampleRuns },
}));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: vi.fn((_keys: string[], fallback: Record<string, unknown>) => Promise.resolve(fallback)) },
}));

import { enqueueSystemCommentSampleRun } from '@/lib/services/aux-remediation';

const params = { analysisId: 'an-1', userId: 'u-1', videoId: 'vid', validationReport: { metadata: { commentCount: '3937' } } };

beforeEach(() => {
  vi.clearAllMocks();
  insertSystemCommentSampleRun.mockResolvedValue({ id: 'run-1', alreadyQueued: false });
  hasSystemSampleRun.mockResolvedValue(false);
  failStaleSystemSampleRuns.mockResolvedValue(undefined);
});

describe('enqueueSystemCommentSampleRun', () => {
  it('marks the inserted run failed when the worker enqueue fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    expect(await enqueueSystemCommentSampleRun(params)).toBe(false);
    expect(markSampleRunFailed).toHaveBeenCalledWith('run-1');
    vi.unstubAllGlobals();
  });

  it('cancels the unread response body on the non-ok path so the socket is released (ARTAS V20)', async () => {
    const res = new Response('down', { status: 503 });
    const cancel = vi.spyOn(res.body as ReadableStream, 'cancel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    await enqueueSystemCommentSampleRun(params);
    expect(cancel).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves the run pending (the worker owns it) when the enqueue succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 202 })));
    expect(await enqueueSystemCommentSampleRun(params)).toBe(true);
    expect(markSampleRunFailed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('inserts nothing when the comment count is unknown', async () => {
    expect(await enqueueSystemCommentSampleRun({ ...params, validationReport: {} })).toBe(false);
    expect(insertSystemCommentSampleRun).not.toHaveBeenCalled();
  });

  it('skips entirely when the analysis already has a system sample run (repeat finalize, #416 follow-up)', async () => {
    hasSystemSampleRun.mockResolvedValue(true);
    expect(await enqueueSystemCommentSampleRun(params)).toBe(false);
    expect(insertSystemCommentSampleRun).not.toHaveBeenCalled();
  });

  it('still enqueues when the payload already carries comments: the run is what feeds the sentiment UI (owner report 2026-10-12)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 202 })));
    expect(await enqueueSystemCommentSampleRun(params)).toBe(true);
    expect(insertSystemCommentSampleRun).toHaveBeenCalled();
  });

  it('releases stale pending/sampling runs (registry staleRunMinutes, default 30) BEFORE the existence check', async () => {
    const order: string[] = [];
    failStaleSystemSampleRuns.mockImplementation(() => { order.push('stale'); return Promise.resolve(); });
    hasSystemSampleRun.mockImplementation(() => { order.push('exists'); return Promise.resolve(false); });
    await enqueueSystemCommentSampleRun(params);
    expect(failStaleSystemSampleRuns).toHaveBeenCalledWith(params.analysisId, 30);
    expect(order).toEqual(['stale', 'exists']);
  });

  it('treats a unique-violation insert (lost race) as already-queued: no enqueue, no error, no failure marking', async () => {
    insertSystemCommentSampleRun.mockResolvedValue({ id: '', alreadyQueued: true });
    expect(await enqueueSystemCommentSampleRun(params)).toBe(false);
    expect(markSampleRunFailed).not.toHaveBeenCalled();
  });

  it('marks the run failed when token signing throws (orphaned-pending bug, #416 follow-up)', async () => {
    vi.doMock('@/lib/stream-token', () => ({
      signCommentsTier3Token: vi.fn().mockRejectedValue(new Error('hmac secret missing')),
      signChannelMetaToken: vi.fn(),
    }));
    vi.resetModules();
    const { enqueueSystemCommentSampleRun: enqueueFresh } = await import('@/lib/services/aux-remediation');
    expect(await enqueueFresh(params)).toBe(false);
    expect(markSampleRunFailed).toHaveBeenCalledWith('run-1');
    vi.doUnmock('@/lib/stream-token');
    vi.resetModules();
  });

  it('marks the run failed when the registry settings lookup throws (orphaned-pending bug, #416 follow-up)', async () => {
    vi.doMock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
      // Only the post-insert sampling-config lookup fails; the pre-insert
      // staleRunMinutes lookup resolves so the run row is inserted first.
      SupabaseSettingsAdapter: {
        getRegistrySettings: vi.fn((keys: string[], fallback: Record<string, unknown>) =>
          keys.includes('comments.system.staleRunMinutes') ? Promise.resolve(fallback) : Promise.reject(new Error('db down'))),
      },
    }));
    vi.resetModules();
    const { enqueueSystemCommentSampleRun: enqueueFresh } = await import('@/lib/services/aux-remediation');
    expect(await enqueueFresh(params)).toBe(false);
    expect(markSampleRunFailed).toHaveBeenCalledWith('run-1');
    vi.doUnmock('@/lib/adapters/SupabaseSettingsAdapter');
    vi.resetModules();
  });

  it('contains a hasSystemSampleRun probe rejection: logs + Sentry, returns false, no insert (probe containment, #424 r3)', async () => {
    const { captureException } = await import('@sentry/nextjs');
    const err = new Error('probe db down');
    hasSystemSampleRun.mockRejectedValue(err);
    expect(await enqueueSystemCommentSampleRun(params)).toBe(false);
    expect(insertSystemCommentSampleRun).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({ contexts: expect.objectContaining({ auxRemediation: expect.objectContaining({ phase: 'comments_enqueue_probe' }) }) }));
  });

});
