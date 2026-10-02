import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAnalysisAdapter } from '@/lib/adapters/SupabaseAnalysisAdapter';

// Mock Supabase service client
const mockMaybeSingle = vi.fn();
const mockNeq = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSelect = vi.fn();
const mockIs = vi.fn();
const mockUpdate = vi.fn();
const mockNot = vi.fn();
const mockRpc = vi.fn();

const queryBuilder: any = {
  select: mockSelect,
  eq: mockEq,
  neq: mockNeq,
  is: mockIs,
  update: mockUpdate,
  not: mockNot,
  order: mockOrder,
  limit: mockLimit,
  maybeSingle: mockMaybeSingle,
};

mockSelect.mockImplementation(() => queryBuilder);
mockEq.mockImplementation(() => queryBuilder);
mockNeq.mockImplementation(() => queryBuilder);
mockIs.mockImplementation(() => queryBuilder);
mockUpdate.mockImplementation(() => queryBuilder);
mockOrder.mockImplementation(() => queryBuilder);
mockLimit.mockImplementation(() => queryBuilder);

const mockFrom = vi.fn(() => queryBuilder);

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

describe('SupabaseAnalysisAdapter.findCachedAnalysis (Content & Status Invariants)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects shell rows containing only stance_relations with 0 dimensions and empty markdown', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'analysis-123',
        video_id: 'video-123',
        title: 'Shell Video',
        analysis_markdown: '',
        analysis_payload: {
          stance_relations: {
            insights: [],
            analysisId: 'analysis-123',
          },
        },
        created_at: new Date().toISOString(),
        validation_report: null,
        billing_status: 'failed',
      },
      error: null,
    });

    const result = await SupabaseAnalysisAdapter.findCachedAnalysis({
      userId: 'user-1',
      videoId: 'video-123',
    });

    expect(result).toBeNull();
  });

  it('accepts rows that have usable dimensions in analysis_payload', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'analysis-456',
        video_id: 'video-456',
        title: 'Complete Video',
        analysis_markdown: 'Substantial markdown output that provides real analysis content for the viewer...',
        analysis_payload: {
          dimensions: [
            { number: 1, name: 'Apex Intelligence', content: 'Detailed analysis content...' },
          ],
        },
        created_at: new Date().toISOString(),
        validation_report: null,
        billing_status: 'completed',
      },
      error: null,
    });

    const result = await SupabaseAnalysisAdapter.findCachedAnalysis({
      userId: 'user-1',
      videoId: 'video-456',
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('analysis-456');
    expect(Object.keys(result?.dimensions ?? {})).toHaveLength(1);
  });

  it('filters out both failed and cancelled billing statuses in the query chain', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await SupabaseAnalysisAdapter.findCachedAnalysis({
      userId: 'user-1',
      videoId: 'video-789',
    });

    expect(mockNeq).toHaveBeenCalledWith('billing_status', 'failed');
    expect(mockNeq).toHaveBeenCalledWith('billing_status', 'cancelled');
    expect(mockNeq).toHaveBeenCalledWith('billing_status', 'processing');
  });
});

describe('SupabaseAnalysisAdapter.persistJevPlan (ownership/idempotence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('conditionally updates only a plan-less row scoped to the analysis id, and stores the plan', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { jev_plan: { K: 1 } }, error: null });

    const result = await SupabaseAnalysisAdapter.persistJevPlan({
      analysisId: 'analysis-plan-1',
      plan: { K: 1, streamCount: 5, cells: [], estimateCents: 27, truncatedFallback: false },
    });

    // Write is scoped to the analysis id and conditional on jev_plan being null.
    expect(mockFrom).toHaveBeenCalledWith('analyses');
    expect(mockUpdate).toHaveBeenCalledWith({ jev_plan: { K: 1, streamCount: 5, cells: [], estimateCents: 27, truncatedFallback: false } });
    expect(mockEq).toHaveBeenCalledWith('id', 'analysis-plan-1');
    expect(mockIs).toHaveBeenCalledWith('jev_plan', null);
    expect(mockSelect).toHaveBeenCalledWith('jev_plan');
    expect(result.stored).toBe(true);
    expect(result.plan).toEqual({ K: 1 });
  });

  it('returns the already-stored plan without writing again when the conditional update lands on zero rows', async () => {
    // First maybeSingle: conditional update matched no rows; second: the follow-up read finds the stored plan.
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: { jev_plan: { K: 3, streamCount: 13 } }, error: null });

    const result = await SupabaseAnalysisAdapter.persistJevPlan({
      analysisId: 'analysis-plan-2',
      plan: { K: 1 },
    });

    expect(result.stored).toBe(false);
    expect(result.plan).toEqual({ K: 3, streamCount: 13 });
    // The follow-up read is also scoped to the analysis id.
    expect(mockEq).toHaveBeenCalledWith('id', 'analysis-plan-2');
    expect(mockIs).toHaveBeenCalledWith('jev_plan', null);
  });

  it('throws when no plan exists and the analysis row is gone', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(
      SupabaseAnalysisAdapter.persistJevPlan({ analysisId: 'analysis-missing', plan: { K: 1 } })
    ).rejects.toThrow('persistJevPlan: analysis row not found: analysis-missing');
  });
});

describe('SupabaseAnalysisAdapter.markJevPlanDegraded (R3b 2.5 degradation hatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates only this analysis, only where a plan already exists', async () => {
    mockNot.mockResolvedValueOnce({ error: null });
    const plan = { K: 2, streamCount: 9, cells: [], degraded: true };
    await SupabaseAnalysisAdapter.markJevPlanDegraded({ analysisId: 'a-1', plan });
    expect(mockFrom).toHaveBeenCalledWith('analyses');
    expect(mockUpdate).toHaveBeenCalledWith({ jev_plan: plan });
    expect(mockEq).toHaveBeenCalledWith('id', 'a-1');
    expect(mockNot).toHaveBeenCalledWith('jev_plan', 'is', null);
  });

  it('throws a write error', async () => {
    mockNot.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(SupabaseAnalysisAdapter.markJevPlanDegraded({ analysisId: 'a-1', plan: { degraded: true } })).rejects.toEqual({ message: 'boom' });
  });
});

describe('SupabaseAnalysisAdapter.isAdminUser (R3b admin gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('true only for users.role === admin', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: 'admin' }, error: null });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ userId: 'u-1' })).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockEq).toHaveBeenCalledWith('id', 'u-1');
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: 'user' }, error: null });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ userId: 'u-2' })).toBe(false);
  });

  it('resolves an analysis to its owner first', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { user_id: 'owner-1' }, error: null })
      .mockResolvedValueOnce({ data: { role: 'admin' }, error: null });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ analysisId: 'an-1' })).toBe(true);
    expect(mockEq).toHaveBeenCalledWith('id', 'an-1');
    expect(mockEq).toHaveBeenCalledWith('id', 'owner-1');
  });

  it('fails closed: missing owner, missing user, or a read error => false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ analysisId: 'gone' })).toBe(false);
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ userId: 'nobody' })).toBe(false);
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await SupabaseAnalysisAdapter.isAdminUser({ userId: 'u-1' })).toBe(false);
  });
});

describe('SupabaseAnalysisAdapter.mergeValidationReport (webhook must never replace the report)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges through the atomic RPC and never issues a full update', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await SupabaseAnalysisAdapter.mergeValidationReport({ analysisId: 'a-1', patch: { markdown_validation: { passed: true } } });
    expect(mockRpc).toHaveBeenCalledWith('merge_analysis_validation_report', { p_analysis_id: 'a-1', p_patch: { markdown_validation: { passed: true } } });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws an RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(SupabaseAnalysisAdapter.mergeValidationReport({ analysisId: 'a-1', patch: {} })).rejects.toEqual({ message: 'boom' });
  });
});

