/**
 * Regression coverage for the 2026-09-09/10 fix (analysis 32aeeb78, video
 * NE-62S4OYCg): DimensionAccordion (dashboard wrapper) used to render the
 * identical bare "Synthesis failed — see the log below." for a genuine total
 * loss AND for a dead analysis with real partial content dimension-
 * remediation.ts's cron is already working to finish -- the customer had no
 * way to tell the two apart. This file had no test coverage before this fix.
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { DimensionAccordion } from '@/components/dashboard/DimensionAccordion';
import { useAnalysisStore } from '@/store/useAnalysisStore';

describe('DimensionAccordion (dashboard) — partial-progress messaging', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the plain failure message for a genuine total loss (no missingDimensions)', () => {
    render(
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={() => {}} status="error" />
    );
    expect(screen.getByText('Synthesis failed — see the log below.')).toBeTruthy();
  });

  it('shows the partial-progress message instead of a bare failure when some dimensions were recovered', () => {
    useAnalysisStore.getState().setError({
      code: 'ERR_ANALYSIS_PARTIAL',
      status: 0,
      message: 'partial',
      missingDimensions: [6, 7, 8, 9, 10, 11],
    });

    render(
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={() => {}} status="error" />
    );

    expect(screen.getByText(/5 of 11 sections finished/i)).toBeTruthy();
    expect(screen.queryByText('Synthesis failed — see the log below.')).toBeNull();
  });

  it('falls back to the plain failure message when missingDimensions is empty (nothing left to finish)', () => {
    useAnalysisStore.getState().setError({
      code: 'ERR_ANALYSIS_PARTIAL',
      status: 0,
      message: 'partial',
      missingDimensions: [],
    });

    render(
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={() => {}} status="error" />
    );

    expect(screen.getByText('Synthesis failed — see the log below.')).toBeTruthy();
  });
});
