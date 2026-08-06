/**
 * useAnalysisStore.setExecutiveDigest — regression coverage
 *
 * Cubic review, PR #207 (P2 finding): setExecutiveDigest was added to
 * bridge useExecutiveDigest.ts's async-fetched digest back into the shared
 * store (fixes the "digest only shows on restored historical analyses,
 * never on a freshly-completed live one" bug) but shipped with zero test
 * coverage. Verifies:
 * 1. Updates analysis.executiveDigest when analysisId matches the current
 *    analysis.
 * 2. Is a no-op when analysisId doesn't match (stale response after the
 *    user switched to a different analysis while the digest fetch was in
 *    flight).
 * 3. Is a no-op when no analysis is currently active (state.analysis is
 *    null) -- guards against a race where the fetch resolves after
 *    clearAnalysis() already ran.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalysisStore } from '@/store/useAnalysisStore';

describe('useAnalysisStore.setExecutiveDigest', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
  });

  it('updates analysis.executiveDigest when analysisId matches the current analysis', () => {
    useAnalysisStore.getState().initializeAnalysis('analysis-1', 'Video Title');
    expect(useAnalysisStore.getState().analysis?.executiveDigest).toBeNull();

    const digest = { summary: 'Key takeaways', confidence: 0.9 };
    useAnalysisStore.getState().setExecutiveDigest('analysis-1', digest);

    expect(useAnalysisStore.getState().analysis?.id).toBe('analysis-1');
    expect(useAnalysisStore.getState().analysis?.executiveDigest).toEqual(digest);
  });

  it('is a no-op when analysisId does not match the current analysis (stale response)', () => {
    useAnalysisStore.getState().initializeAnalysis('analysis-current', 'Current Video');

    // Simulate a slow digest fetch for a PREVIOUS analysis resolving after
    // the user has already switched to a new one.
    useAnalysisStore.getState().setExecutiveDigest('analysis-stale', { summary: 'Stale digest' });

    expect(useAnalysisStore.getState().analysis?.id).toBe('analysis-current');
    expect(useAnalysisStore.getState().analysis?.executiveDigest).toBeNull();
  });

  it('is a no-op when no analysis is currently active', () => {
    expect(useAnalysisStore.getState().analysis).toBeNull();

    useAnalysisStore.getState().setExecutiveDigest('analysis-1', { summary: 'Orphaned digest' });

    expect(useAnalysisStore.getState().analysis).toBeNull();
  });
});
