import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAnalysisAdapter } from '@/lib/adapters/SupabaseAnalysisAdapter';

// Mock Supabase service client
const mockMaybeSingle = vi.fn();
const mockNeq = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSelect = vi.fn();

const queryBuilder: any = {
  select: mockSelect,
  eq: mockEq,
  neq: mockNeq,
  order: mockOrder,
  limit: mockLimit,
  maybeSingle: mockMaybeSingle,
};

mockSelect.mockImplementation(() => queryBuilder);
mockEq.mockImplementation(() => queryBuilder);
mockNeq.mockImplementation(() => queryBuilder);
mockOrder.mockImplementation(() => queryBuilder);
mockLimit.mockImplementation(() => queryBuilder);

const mockFrom = vi.fn(() => queryBuilder);

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: mockFrom,
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
