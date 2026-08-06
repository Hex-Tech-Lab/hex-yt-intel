/**
 * Regression test for the useExecutiveDigest digest-not-syncing-to-store bug
 * (2026-08-06).
 *
 * The original implementation computed the digest in its own local React
 * state (useState) but never bridged it into useAnalysisStore. Consumers
 * reading useAnalysisStore.analysis.executiveDigest directly (e.g.
 * AnalysisHistory's "currently analyzing" card) saw it populated only when
 * restoring an already-digested historical analysis, never for a fresh live
 * one. The fix (setExecutiveDigest) bridges the async-fetched digest back
 * into the shared store. This test verifies that:
 * 1. A successful /api/analyses/digest response populates
 *    useAnalysisStore.getState().analysis?.executiveDigest.
 * 2. A stale/different analysisId response is silently ignored (no-op)
 *    when the current analysis has a different id.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useExecutiveDigest } from '@/hooks/useExecutiveDigest';
import { useAnalysisStore } from '@/store/useAnalysisStore';

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useExecutiveDigest store bridging', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('populates useAnalysisStore.executiveDigest when the digest API responds successfully', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      okResponse({
        digest: { overview: 'Test overview', snapshot: 'Snap', takeaways: ['T1'], detailedSummary: 'Detail' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    // Initialize an analysis so the store has a valid analysisId.
    useAnalysisStore.getState().initializeAnalysis('analysis-1', 'Test Video');
    expect(useAnalysisStore.getState().analysis?.executiveDigest).toBeNull();

    renderHook(() => useExecutiveDigest('analysis-1', 'complete'));

    // Let the promise chain settle.
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(useAnalysisStore.getState().analysis?.executiveDigest).toBeTruthy();
    });

    const digest = useAnalysisStore.getState().analysis?.executiveDigest;
    expect(digest).toHaveProperty('overview', 'Test overview');
  });

  it('does not populate the store when a stale/different analysisId resolves', async () => {
    const fetchMock = vi.fn();
    let resolvePromise: (v: Response) => void = () => {};
    fetchMock.mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    useAnalysisStore.getState().initializeAnalysis('analysis-current', 'Current Video');

    renderHook(() => useExecutiveDigest('analysis-current', 'complete'));

    // Before the fetch settles, simulate a switch: re-init with a different id.
    useAnalysisStore.getState().initializeAnalysis('analysis-new', 'New Video');

    // Now let the STALE fetch resolve.
    await act(async () => {
      resolvePromise(
        okResponse({
          digest: { overview: 'Stale digest', snapshot: '', takeaways: [], detailedSummary: '' },
        })
      );
    });
    await vi.advanceTimersByTimeAsync(100);

    // The current analysis should NOT have the stale digest.
    expect(useAnalysisStore.getState().analysis?.executiveDigest).toBeNull();
  });
});