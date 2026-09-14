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

const noop = () => undefined;

describe('DimensionAccordion (dashboard) — partial-progress messaging', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the plain failure message for a genuine total loss (no missingDimensions)', () => {
    render(
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={noop} status="error" />
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
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={noop} status="error" />
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
      <DimensionAccordion dimensions={[]} selectedDimensionKey={null} onSelectDimension={noop} status="error" />
    );

    expect(screen.getByText('Synthesis failed — see the log below.')).toBeTruthy();
  });
});

describe('DimensionAccordion (dashboard) — progress label reflects real coverage (RCA 2026-09-13)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
  });

  afterEach(() => {
    cleanup();
  });

  const partialDims = (count: number) =>
    Array.from({ length: count }, (_unusedItem, i) => ({
      key: `dim-${i + 1}`,
      label: `Dimension ${i + 1}`,
      icon: 'solar:bolt-linear',
      status: 'done' as const,
      content: `content ${i + 1}`,
      span: 1 as const,
    }));

  it('a complete status with fewer than 11 dimensions states the real coverage, not "100% complete"', () => {
    // The live incident: status settled 'complete' with 6/11 dimensions
    // while the header claimed 100% (video gKgWYFOhZx0).
    render(
      <DimensionAccordion dimensions={partialDims(6)} selectedDimensionKey={null} onSelectDimension={noop} status="complete" />
    );
    expect(screen.getByText('6/11 dimensions')).toBeTruthy();
    expect(screen.queryByText('100% complete')).toBeNull();
  });

  it('a complete status with all 11 dimensions still says "100% complete"', () => {
    render(
      <DimensionAccordion dimensions={partialDims(11)} selectedDimensionKey={null} onSelectDimension={noop} status="complete" />
    );
    expect(screen.getByText('100% complete')).toBeTruthy();
  });

  it('analyzing status keeps the "Processing..." label regardless of coverage', () => {
    render(
      <DimensionAccordion dimensions={partialDims(6)} selectedDimensionKey={null} onSelectDimension={noop} status="analyzing" />
    );
    expect(screen.getByText('Processing...')).toBeTruthy();
  });
});
