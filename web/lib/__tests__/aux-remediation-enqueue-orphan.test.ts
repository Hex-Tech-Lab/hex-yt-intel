/**
 * enqueueSystemCommentSampleRun is now called at every finalize. A run row
 * inserted as 'pending' whose worker enqueue then fails must be marked
 * 'failed', never left orphaned 'pending' (cubic #416 review).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertSystemCommentSampleRun = vi.hoisted(() => vi.fn());
const markSampleRunFailed = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { cloudflareWorkerUrl: 'https://worker.test', appUrl: 'https://www.getvintel.com' } }));
vi.mock('@/lib/stream-token', () => ({
  signCommentsTier3Token: vi.fn().mockResolvedValue({ sig: 's', exp: 1 }),
  signChannelMetaToken: vi.fn(),
}));
vi.mock('@/lib/adapters', () => ({ SupabasePersistenceAdapter: class {} }));
vi.mock('@/lib/qstash-client', () => ({ publishEmbeddingTask: vi.fn() }));
vi.mock('@/lib/adapters/SupabaseAuxRemediationAdapter', () => ({
  SupabaseAuxRemediationAdapter: { insertSystemCommentSampleRun, markSampleRunFailed },
}));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings: vi.fn((_keys: string[], fallback: Record<string, unknown>) => Promise.resolve(fallback)) },
}));

import { enqueueSystemCommentSampleRun } from '@/lib/services/aux-remediation';

const params = { analysisId: 'an-1', userId: 'u-1', videoId: 'vid', validationReport: { metadata: { commentCount: '3937' } } };

beforeEach(() => {
  vi.clearAllMocks();
  insertSystemCommentSampleRun.mockResolvedValue({ id: 'run-1' });
});

describe('enqueueSystemCommentSampleRun', () => {
  it('marks the inserted run failed when the worker enqueue fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    expect(await enqueueSystemCommentSampleRun(params)).toBe(false);
    expect(markSampleRunFailed).toHaveBeenCalledWith('run-1');
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
});
