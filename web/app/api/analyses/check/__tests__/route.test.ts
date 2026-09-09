/**
 * Sibling test for the /api/analyses/check route — added 2026-09-09 (ADR 021
 * Phase 2) after qa-intel flagged the route as an authorization-relevant file
 * with no sibling regression test.
 *
 * Covers:
 * - the authorization branch (unauthenticated request → route's own failure
 *   contract, never the analysis data),
 * - the terminal-error surfacing of the ADR 021 Phase 2 presence-check field
 *   (`missingDimensions` — which dimensions are already durably covered by
 *   completed analysis_chunks rows for the dead analysis), including its
 *   fail-open behavior when the presence check itself fails,
 * - that the happy 'complete' path never consults the chunk journal (hot
 *   cache-hit path must stay query-free for the presence check).
 *
 * Mock convention follows lib/__tests__/entitlements-route.test.ts (mock
 * '@/lib/supabase' + the collaborators, import the real GET).
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(),
}));

vi.mock('@/lib/services/chunk-presence', () => ({
  getMissingDimensionNumbers: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
  // Pass-through: run the wrapped query callback as-is.
  trackDatabaseQuery: vi.fn((_op: string, _table: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/analyses/check/route';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getMissingDimensionNumbers } from '@/lib/services/chunk-presence';

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-check-route-1';

/** Build the minimal analyses-query builder the route's Supabase chain needs. */
// skipcq: JS-0067
function mockAnalysesQuery(data: unknown[], error: unknown = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(Promise.resolve({ data, error }));
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user_1' } }, error: null }) },
    from: vi.fn().mockReturnValue(builder),
  };
  (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  return builder;
}

// skipcq: JS-0067
function checkRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/analyses/check?videoId=${VIDEO_ID}`);
}

describe('GET /api/analyses/check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unauthenticated request through the route failure contract instead of returning analysis data', async () => {
    (getSupabaseClientWithAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });

    const res = await GET(checkRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Pre-flight check failed');
  });

  it('returns 400 for an invalid videoId format', async () => {
    const res = await GET(new NextRequest('http://localhost/api/analyses/check?videoId=bad!!id'));
    expect(res.status).toBe(400);
  });

  it('selects updated_at — regression guard for the staleness-clock contract, so removing it can never silently restore the created_at-only bug', async () => {
    const builder = mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: '# md', created_at: new Date().toISOString(), model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'completed' },
    ]);

    await GET(checkRequest());

    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('updated_at'));
  });

  it('returns the complete cache-hit WITHOUT consulting the chunk journal', async () => {
    mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: '# md', created_at: new Date().toISOString(), model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'completed' },
    ]);

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('complete');
    expect(body.analysisId).toBe(ANALYSIS_ID);
    expect(getMissingDimensionNumbers).not.toHaveBeenCalled();
  });

  it('surfaces missingDimensions (ADR 021 Phase 2) on the terminal-error (stale processing) response', async () => {
    // Row is >120s old (PROCESSING_STALE_MS) and not completed → stale error.
    const staleCreatedAt = new Date(Date.now() - 121_000).toISOString();
    mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: null, created_at: staleCreatedAt, model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'processing' },
    ]);
    (getMissingDimensionNumbers as ReturnType<typeof vi.fn>).mockResolvedValue([6, 7, 8, 9, 10, 11]);

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.analysisId).toBe(ANALYSIS_ID);
    expect(getMissingDimensionNumbers).toHaveBeenCalledWith(ANALYSIS_ID, 11);
    expect(body.missingDimensions).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('surfaces missingDimensions on the explicit failure response (billing_status=failed) for a partial-chunk analysis', async () => {
    // The 32aeeb78 incident shape: worker died mid-stream, 2/5 chunks durable,
    // parent row failed. Presence check must still surface the salvageable set.
    mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: null, created_at: new Date().toISOString(), model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'failed' },
    ]);
    (getMissingDimensionNumbers as ReturnType<typeof vi.fn>).mockResolvedValue([4, 5, 6, 7, 8, 9, 10, 11]);

    const res = await GET(checkRequest());
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.missingDimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('does NOT report a genuinely in-flight row as stale just because created_at is old (updated_at is the real clock)', async () => {
    // Regression guard for the created_at-vs-updated_at staleness-clock bug
    // (same class independently fixed 2026-09-09 in
    // /api/analyses/[id]/status/route.ts, commit 662efa41): a row started
    // >120s ago but whose updated_at was just touched by the worker's
    // incremental dimension write is still healthy, not dead.
    const oldCreatedAt = new Date(Date.now() - 121_000).toISOString();
    const freshUpdatedAt = new Date(Date.now() - 1_000).toISOString();
    mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: null, created_at: oldCreatedAt, updated_at: freshUpdatedAt, model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'processing' },
    ]);

    const res = await GET(checkRequest());
    const body = await res.json();
    expect(body.status).toBe('processing');
    expect(getMissingDimensionNumbers).not.toHaveBeenCalled();
  });

  it('fail-opens when the presence check itself errors — the status contract stays intact without the field', async () => {
    const staleCreatedAt = new Date(Date.now() - 121_000).toISOString();
    mockAnalysesQuery([
      { id: ANALYSIS_ID, title: 'T', channel_title: 'C', analysis_markdown: null, created_at: staleCreatedAt, model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'processing' },
    ]);
    (getMissingDimensionNumbers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('chunks query failed'));

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.missingDimensions).toBeUndefined();
  });

  it('does NOT fall back to older completed analysis when newest row has billing_status=failed', async () => {
    const oldDate = new Date(Date.now() - 200_000).toISOString();
    const olderCompletedDate = new Date(Date.now() - 300_000).toISOString();
    mockAnalysesQuery([
      { id: 'failed-analysis', title: 'Failed T', channel_title: 'C', analysis_markdown: null, created_at: oldDate, updated_at: oldDate, model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'failed' },
      { id: 'older-completed', title: 'Completed T', channel_title: 'C', analysis_markdown: '# Done', created_at: olderCompletedDate, updated_at: olderCompletedDate, model_used: 'm', validation_report: {}, billing_status: 'completed' },
    ]);
    (getMissingDimensionNumbers as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2]);

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.analysisId).toBe('failed-analysis');
    expect(body.missingDimensions).toEqual([1, 2]);
  });

  it('does NOT fall back to older completed analysis when newest row has validation_report.status=error', async () => {
    const oldDate = new Date(Date.now() - 200_000).toISOString();
    const olderCompletedDate = new Date(Date.now() - 300_000).toISOString();
    mockAnalysesQuery([
      { id: 'error-analysis', title: 'Error T', channel_title: 'C', analysis_markdown: null, created_at: oldDate, updated_at: oldDate, model_used: 'm', validation_report: { status: 'error', error: 'LLM failed' }, billing_status: 'processing' },
      { id: 'older-completed', title: 'Completed T', channel_title: 'C', analysis_markdown: '# Done', created_at: olderCompletedDate, updated_at: olderCompletedDate, model_used: 'm', validation_report: {}, billing_status: 'completed' },
    ]);
    (getMissingDimensionNumbers as ReturnType<typeof vi.fn>).mockResolvedValue([3, 4]);

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.analysisId).toBe('error-analysis');
    expect(body.error).toBe('LLM failed');
    expect(body.missingDimensions).toEqual([3, 4]);
  });

  it('falls back to older completed analysis when newest row is a genuinely stale in-flight processing row without explicit errors', async () => {
    const staleProcessingDate = new Date(Date.now() - 200_000).toISOString();
    const olderCompletedDate = new Date(Date.now() - 300_000).toISOString();
    mockAnalysesQuery([
      { id: 'stale-processing', title: 'Stale T', channel_title: 'C', analysis_markdown: null, created_at: staleProcessingDate, updated_at: staleProcessingDate, model_used: 'm', validation_report: { status: 'processing' }, billing_status: 'processing' },
      { id: 'older-completed', title: 'Completed T', channel_title: 'C', analysis_markdown: '# Done', created_at: olderCompletedDate, updated_at: olderCompletedDate, model_used: 'm', validation_report: {}, billing_status: 'completed' },
    ]);

    const res = await GET(checkRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('complete');
    expect(body.analysisId).toBe('older-completed');
  });
});
