/**
 * The UCIS markdown webhook must MERGE its result into validation_report
 * under `markdown_validation`, never replace the report: a full replace wiped
 * status, dimension_status, metadata and jev_partial_dimensions written by the
 * persist finalize (Carmack run 2026-10-02, most completed rows since 09-21).
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mergeValidationReport = vi.fn();
const updateValidationReport = vi.fn();
const verifyQStashSignature = vi.fn();
const publishEmbeddingTask = vi.fn();

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
  trackDatabaseQuery: (_op: string, _table: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/qstash-client', () => ({
  verifyQStashSignature: (...args: unknown[]) => verifyQStashSignature(...args),
  publishEmbeddingTask: (...args: unknown[]) => publishEmbeddingTask(...args),
}));
vi.mock('@/lib/adapters/SupabasePersistenceAdapter', () => ({
  SupabasePersistenceAdapter: class {
    mergeValidationReport = mergeValidationReport;
    updateValidationReport = updateValidationReport;
  },
}));

import { POST } from '../route';

function post(body: unknown) {
  return POST(new NextRequest('https://getvintel.com/api/webhooks/validate', {
    method: 'POST',
    headers: { 'upstash-signature': 'sig' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyQStashSignature.mockResolvedValue(true);
  mergeValidationReport.mockResolvedValue(undefined);
  publishEmbeddingTask.mockResolvedValue('msg-1');
});

describe('POST /api/webhooks/validate', () => {
  it('merges its report under markdown_validation and never replaces validation_report', async () => {
    const res = await post({ videoId: 'vid', analysisId: 'an-1', userId: 'u-1', markdown: '# Title\n\nbody', filename: 'x.md' });
    expect(res.status).toBe(200);
    expect(updateValidationReport).not.toHaveBeenCalled();
    expect(mergeValidationReport).toHaveBeenCalledTimes(1);
    const { analysisId, patch } = mergeValidationReport.mock.calls[0]?.[0] as { analysisId: string; patch: Record<string, unknown> };
    expect(analysisId).toBe('an-1');
    expect(Object.keys(patch)).toEqual(['markdown_validation']);
    expect(patch.markdown_validation).toMatchObject({ totalChecks: expect.any(Number) });
  });

  it('401 and no write without a valid QStash signature', async () => {
    verifyQStashSignature.mockResolvedValue(false);
    expect((await post({ videoId: 'vid', analysisId: 'an-1', markdown: 'x' })).status).toBe(401);
    expect(mergeValidationReport).not.toHaveBeenCalled();
  });

  it('success path unchanged: 200 and the embedding task published', async () => {
    const res = await post({ videoId: 'vid', analysisId: 'an-1', userId: 'u-1', markdown: '# Title\n\nbody', filename: 'x.md' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, analysisId: 'an-1' });
    expect(publishEmbeddingTask).toHaveBeenCalledTimes(1);
    expect(publishEmbeddingTask).toHaveBeenCalledWith({ analysisId: 'an-1', markdown: '# Title\n\nbody', userId: 'u-1' });
  });

  it('embedding publish failure is fail-closed: 503 (QStash redelivers), never a ghost 200', async () => {
    publishEmbeddingTask.mockRejectedValueOnce(new Error('qstash publish failed'));
    const res = await post({ videoId: 'vid', analysisId: 'an-1', userId: 'u-1', markdown: '# Title\n\nbody', filename: 'x.md' });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ success: false });
    expect(publishEmbeddingTask).toHaveBeenCalledTimes(1);
  });

  it('the publish failure still reaches Sentry exactly once (no silent swallow)', async () => {
    const Sentry = await import('@sentry/nextjs');
    publishEmbeddingTask.mockRejectedValueOnce(new Error('qstash publish failed'));
    await post({ videoId: 'vid', analysisId: 'an-1', userId: 'u-1', markdown: '# Title\n\nbody', filename: 'x.md' });
    const captures = vi.mocked(Sentry.captureException).mock.calls;
    expect(captures).toHaveLength(1);
    expect(captures[0]?.[0]).toBeInstanceOf(Error);
    expect((captures[0]?.[0] as Error).message).toBe('qstash publish failed');
  });

  it('redelivery-safe: a replayed delivery performs the identical idempotent merge (and nothing else)', async () => {
    const body = { videoId: 'vid', analysisId: 'an-1', userId: 'u-1', markdown: '# Title\n\nbody', filename: 'x.md' };
    await post(body);
    await post(body);
    expect(mergeValidationReport).toHaveBeenCalledTimes(2);
    expect(updateValidationReport).not.toHaveBeenCalled();
    // The UCIS report stamps a fresh `timestamp` per run; idempotency is
    // logical (same patch content → same merged JSONB state), not byte-exact.
    const stripTimestamp = (call: unknown[] | undefined) => {
      const patch = (call?.[0] as { patch: { markdown_validation: Record<string, unknown> } }).patch;
      const { timestamp: _ignored, ...report } = patch.markdown_validation;
      return { analysisId: (call?.[0] as { analysisId: string }).analysisId, patch: { markdown_validation: report } };
    };
    expect(stripTimestamp(mergeValidationReport.mock.calls[1])).toEqual(stripTimestamp(mergeValidationReport.mock.calls[0]));
  });
});
