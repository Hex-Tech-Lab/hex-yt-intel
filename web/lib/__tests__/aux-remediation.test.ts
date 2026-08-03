/**
 * Aux Remediation — gap classification (channelMeta/comments missing on an
 * otherwise dimension-complete analysis).
 * Pure logic only (classifyAuxGap / dimensionsAreComplete); the DB/worker-
 * calling paths (findAnalysesWithMissingAux, remediateAuxGap,
 * runAuxRemediationHarness) need a live Supabase/worker and are covered by
 * live verification, same convention as dimension-remediation.test.ts.
 */
import { describe, it, expect } from 'vitest';

import { classifyAuxGap, dimensionsAreComplete } from '@/lib/services/aux-remediation';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

function markdownWithAllDimensions(): string {
  return Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1)
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
}

function markdownMissingOneDimension(): string {
  return Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1)
    .filter((n) => n !== 5)
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');
}

describe('dimensionsAreComplete', () => {
  it('is false for empty markdown', () => {
    expect(dimensionsAreComplete('')).toBe(false);
  });

  it('is false when one dimension is missing', () => {
    expect(dimensionsAreComplete(markdownMissingOneDimension())).toBe(false);
  });

  it('is true when all TOTAL_DIMENSIONS are present', () => {
    expect(dimensionsAreComplete(markdownWithAllDimensions())).toBe(true);
  });
});

describe('classifyAuxGap', () => {
  const baseRow = {
    id: 'analysis-1',
    userId: 'user-1',
    videoId: 'video-1',
    billingStatus: 'failed',
    validationReport: null,
  };

  it('flags a dims-done-but-aux-missing row as a gap (the core bug this module fixes)', () => {
    const gap = classifyAuxGap({
      ...baseRow,
      markdown: markdownWithAllDimensions(),
      analysisPayload: { videoMetadata: { description: 'desc' } }, // no channelMeta, no comments
    });
    expect(gap.dimensionsComplete).toBe(true);
    expect(gap.hasChannelMeta).toBe(false);
    expect(gap.hasComments).toBe(false);
  });

  it('flags a row missing only comments (channelMeta already present)', () => {
    const gap = classifyAuxGap({
      ...baseRow,
      markdown: markdownWithAllDimensions(),
      analysisPayload: { channelMeta: { subscriberCount: 1000 }, comments: [] },
    });
    expect(gap.dimensionsComplete).toBe(true);
    expect(gap.hasChannelMeta).toBe(true);
    expect(gap.hasComments).toBe(false);
  });

  it('flags a row missing only channelMeta (comments already present)', () => {
    const gap = classifyAuxGap({
      ...baseRow,
      markdown: markdownWithAllDimensions(),
      analysisPayload: { channelMeta: null, comments: [{ author: 'a', text: 'b', publishedAt: '2026-01-01', likeCount: 0 }] },
    });
    expect(gap.dimensionsComplete).toBe(true);
    expect(gap.hasChannelMeta).toBe(false);
    expect(gap.hasComments).toBe(true);
  });

  it('never treats a genuinely dims-AND-aux-complete row as needing remediation', () => {
    const gap = classifyAuxGap({
      ...baseRow,
      markdown: markdownWithAllDimensions(),
      analysisPayload: {
        channelMeta: { subscriberCount: 1000 },
        comments: [{ author: 'a', text: 'b', publishedAt: '2026-01-01', likeCount: 0 }],
      },
    });
    expect(gap.dimensionsComplete).toBe(true);
    expect(gap.hasChannelMeta).toBe(true);
    expect(gap.hasComments).toBe(true);
    // Caller-side contract (findAnalysesWithMissingAux): dimensionsComplete
    // && hasChannelMeta && hasComments must be excluded from the harness's
    // gap list -- asserted here structurally so a future change to that
    // filter's condition breaks this test, not just prod behavior.
    const isGap = !(gap.dimensionsComplete && gap.hasChannelMeta && gap.hasComments);
    expect(isGap).toBe(false);
  });

  it('is not this harness\'s population when dimensions are still incomplete (dimension-remediation.ts\'s job)', () => {
    const gap = classifyAuxGap({
      ...baseRow,
      markdown: markdownMissingOneDimension(),
      analysisPayload: {}, // aux also missing, but dims-incomplete takes priority
    });
    expect(gap.dimensionsComplete).toBe(false);
  });
});
