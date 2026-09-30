// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCommentInsights } from '@/hooks/useCommentInsights';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';

const INSIGHTS = {
  population: 1800,
  reportedTotal: 1800,
  sampleSize: 320,
  classified: 318,
  failed: 2,
  lowConfidence: 4,
  marginOfError: 0.054,
  confidence: 0.95,
  marginScope: 'sampled_pool' as const,
  sentiment: { positive: 180, negative: 60, neutral: 60, mixed: 18 },
  types: { question: 40, praise: 20 },
  painPointCount: 12,
  questionCount: 40,
  costUsd: 0.01,
  model: 'jev',
  completedAt: '2026-09-30T00:00:00.000Z',
};

type FetchMock = (input: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

function mockFetch(impl: FetchMock) {
  return vi.fn(impl as unknown as typeof fetch);
}

beforeEach(() => {
  useSynthesisNucleus.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCommentInsights', () => {
  it('returns ready immediately when the in-memory payload has insights', async () => {
    useSynthesisNucleus.getState().setRawAnalysisPayload(
      { commentInsights: INSIGHTS } as never,
      ANALYSIS_ID
    );
    const fetchMock = mockFetch(() => { throw new Error('should not fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.insights).toMatchObject({ sampleSize: 320, marginScope: 'sampled_pool' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a payload tagged to a different analysis', async () => {
    useSynthesisNucleus.getState().setRawAnalysisPayload(
      { commentInsights: INSIGHTS } as never,
      'other-analysis-id'
    );
    const fetchMock = mockFetch(() => { throw new Error('should not fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.state).toBe('none'));
    expect(result.current.insights).toBeNull();
  });

  it('rejects a malformed payload commentInsights instead of casting', async () => {
    useSynthesisNucleus.getState().setRawAnalysisPayload(
      { commentInsights: { sampleSize: 'not-a-number' } } as never,
      ANALYSIS_ID
    );
    vi.stubGlobal('fetch', mockFetch(() => { throw new Error('should not fetch'); }));

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.state).toBe('none'));
    expect(result.current.insights).toBeNull();
  });

  it('polls analyzing runs and transitions to ready on completed', async () => {
    vi.useFakeTimers();
    let runStatus = 'sampling';
    let payloadHasInsights = false;
    const fetchMock = mockFetch((input) => {
      if (input.includes('/api/comments/runs/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ run: { id: 'r1', status: runStatus, mode: 'cochran', sampled_count: 0, created_at: '', completed_at: null } }),
        });
      }
      // persisted payload fetch
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payloadHasInsights ? { analysis_payload: { commentInsights: INSIGHTS } } : { analysis_payload: {} }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(result.current.state).toBe('analyzing'));

    // First poll tick: runs endpoint still sampling.
    await vi.advanceTimersByTimeAsync(5000);
    expect(result.current.state).toBe('analyzing');

    // Run completes; next tick should refetch payload → ready.
    runStatus = 'completed';
    payloadHasInsights = true;
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.insights).toMatchObject({ classified: 318 });
  });

  it('stops polling after the 3-minute cap', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ run: { id: 'r1', status: 'sampling', mode: 'cochran', sampled_count: 0, created_at: '', completed_at: null } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), { wrapper: StrictMode });

    // Well past the 180s cap: the run-status fetch stops being called again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    const runCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes('/api/comments/runs/')
    ).length;
    // initial + ~36 polls within cap (180s / 5s), well below an unbounded count
    expect(runCalls).toBeLessThanOrEqual(40);
    expect(runCalls).toBeGreaterThan(0);
    // The cap never leaves a permanent "Analyzing sentiment…" label.
    expect(result.current.state).toBe('none');
    // Poll ticks only hit the run-status route; the full payload is read up
    // front (once per effect run; StrictMode double-invokes) -- not per tick.
    const payloadCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes('/api/analyses/')
    ).length;
    expect(payloadCalls).toBeLessThanOrEqual(2);
  });

  it('reports failed when the run failed', async () => {
    vi.stubGlobal('fetch', mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ run: { id: 'r1', status: 'failed', mode: 'cochran', sampled_count: 0, created_at: '', completed_at: null } }),
      })
    ));

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.insights).toBeNull();
  });

  it('reports none when no run exists', async () => {
    vi.stubGlobal('fetch', mockFetch(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ run: null }) })
    ));

    const { result } = renderHook(() => useCommentInsights(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.state).toBe('none'));
  });
});
