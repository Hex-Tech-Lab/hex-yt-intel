import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logActivityBestEffort } from '../activity-log';

const insertMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({ insert: insertMock }),
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

describe('logActivityBestEffort', () => {
  beforeEach(() => {
    insertMock.mockReset();
    vi.mocked(Sentry.captureMessage).mockReset();
  });

  it('resolves silently on a successful insert (no Sentry call)', async () => {
    insertMock.mockResolvedValue({ error: null });
    await logActivityBestEffort('dub_share', { linkId: 'x' }, 'DubShortLinkAdapter', 'dub-share-audit');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('reports a returned Supabase { error } to Sentry with the stable operation tag', async () => {
    insertMock.mockResolvedValue({ error: { message: 'RLS violation', code: '42501' } });
    await logActivityBestEffort('dub_share', { linkId: 'x' }, 'DubShortLinkAdapter', 'dub-share-audit');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('[DubShortLinkAdapter]'),
      expect.objectContaining({ tags: { operation: 'dub-share-audit' } })
    );
  });

  it('reports a thrown exception to Sentry too, not just console.warn (real gap fixed 2026-08-20)', async () => {
    insertMock.mockRejectedValue(new Error('network unreachable'));
    await logActivityBestEffort('testsprite_bypass', { email: 'x' }, 'test-auth-bypass', 'test-auth-bypass-audit');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('[test-auth-bypass]'),
      expect.objectContaining({ tags: { operation: 'test-auth-bypass-audit' } })
    );
  });

  it('never throws -- callers must be able to await it without a try/catch', async () => {
    insertMock.mockRejectedValue(new Error('boom'));
    await expect(
      logActivityBestEffort('dub_share', {}, 'DubShortLinkAdapter', 'dub-share-audit')
    ).resolves.toBeUndefined();
  });
});
