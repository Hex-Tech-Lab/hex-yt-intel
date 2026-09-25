/**
 * Full-duration coverage + non-overlap regression tests (2026-09-25 RCA,
 * analysis 434ef182 / video f6We53TnkbU, 32 min): the prior single-pass
 * extraction covered only the first ~50% of the timeline and consecutive
 * highlights could start inside the previous one. The 32-min fixture below
 * proves the windowed harvest produces candidates spanning >=90% of the
 * duration with zero overlapping intervals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn().mockResolvedValue({
      'highlights.maxCount': 40,
      'highlights.maxOutputTokens': 6000,
      'highlights.segmentDurationSeconds': 10,
      'highlights.contextLeadSeconds': 2.5,
      'highlights.minSegmentDurationSeconds': 15,
      'highlights.maxSegmentDurationSeconds': 60,
    }),
  },
}));

import { ExtractHighlightsUseCase } from '@/lib/usecases/ExtractHighlightsUseCase';
import { resolveHighlightOverlaps } from '@/lib/prompts/highlights-extraction';

// 32-minute fixture: one segment every 10s from 0 to 1910 (matches the real
// f6We53TnkbU transcript density: 1006 segments over 1930s).
const DURATION_SECONDS = 1920;
const SEGMENTS = Array.from({ length: DURATION_SECONDS / 10 }, (_unused, i) => ({
  start: i * 10,
  text: `Segment ${i} of the 32-minute fixture`,
}));

type PersistenceSpy = {
  getTranscriptSegments: ReturnType<typeof vi.fn>;
  saveHighlights: ReturnType<typeof vi.fn>;
  findHighlightsForAnalysis: ReturnType<typeof vi.fn>;
};

/**
 * Completion mock that answers each per-window call with highlights anchored
 * inside THAT window: reads the excerpt's segment starts out of the user
 * message and returns up to `perCall` picks at those real segment starts
 * (the parser requires exact segment-start matches). This simulates an
 * unbiased harvest where every window contributes.
 */
function makeWindowAwareCompletion(perCall = 1, failEveryNthCall = 0) {
  let callCount = 0;
  return {
    complete: vi.fn().mockImplementation(({ user }: { user: string }) => {
      callCount += 1;
      if (failEveryNthCall > 0 && callCount % failEveryNthCall === 0) {
        return Promise.reject(new Error('window LLM down'));
      }
      const starts = [...user.matchAll(/\[(\d+(?:\.\d+)?)\]/g)].map((m) => Number(m[1]));
      const picks = starts.slice(0, perCall /* ellipsis: array slice, not string truncation ... */).map((start) => ({
        start,
        end: start + 30,
        label: `Moment at ${start}`,
        parent_takeaway_idx: null,
      }));
      return Promise.resolve({ text: JSON.stringify(picks), model: 'test/model' });
    }),
  };
}

const makeDeps = (completion: unknown) => {
  const persistence: PersistenceSpy = {
    getTranscriptSegments: vi.fn().mockResolvedValue(
      Array.from({ length: DURATION_SECONDS / 10 }, (_unused, i) => ({ start: i * 10, text: `Segment ${i}` }))
    ),
    saveHighlights: vi.fn().mockResolvedValue(true),
    findHighlightsForAnalysis: vi.fn().mockResolvedValue([]),
  };
  return {
    useCase: new ExtractHighlightsUseCase(persistence as never, completion as never),
    persistence,
  };
};

const baseParams = {
  analysisId: 'an-1',
  videoId: 'vid-1',
  models: [{ model: 'test/model' }] as const,
};

describe('full-duration highlights coverage (32-min fixture)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('harvested candidates span >=90% of the video duration', async () => {
    const completion = makeWindowAwareCompletion(3);
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });

    expect(persistence.saveHighlights).toHaveBeenCalledTimes(1);
    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number; end: number }>;
    expect(saved.length).toBeGreaterThan(0);
    const maxEnd = Math.max(...saved.map((h) => h.end));
    expect(maxEnd / DURATION_SECONDS).toBeGreaterThanOrEqual(0.9);
  });

  it('saved highlights are strictly non-overlapping and start-ordered', async () => {
    const completion = makeWindowAwareCompletion(3);
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });

    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number; end: number }>;
    for (let i = 1; i < saved.length; i++) {
      expect(saved[i]!.start).toBeGreaterThanOrEqual(saved[i - 1]!.end);
    }
    for (const h of saved) {
      expect(h.end).toBeGreaterThan(h.start);
    }
  });

  it('a failed window contributes nothing while other windows still persist', async () => {
    const completion = makeWindowAwareCompletion(3, 2); // every 2nd call throws
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });

    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number }>;
    expect(saved.length).toBeGreaterThan(0); // partial coverage survives
    // Every 2nd window call fails (0-indexed windows 1, 3, 5): their
    // 300-599 / 900-1199 / 1500-1799 ranges must contribute nothing.
    const failedRanges = [
      [300, 600],
      [900, 1200],
      [1500, 1800],
    ];
    for (const h of saved) {
      for (const [lo, hi] of failedRanges) {
        const insideFailedRange = h.start >= lo && h.start < hi;
        expect(insideFailedRange).toBe(false);
      }
    }
  });

  it('an all-windows-failed harvest persists nothing (no empty REPLACE wipe)', async () => {
    const completion = { complete: vi.fn().mockRejectedValue(new Error('LLM down')) };
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });
});

describe('resolveHighlightOverlaps', () => {
  it('trims a highlight that starts inside the previous one (2026-09-25 overlap RCA shape)', () => {
    const resolved = resolveHighlightOverlaps(
      [
        { start: 456.1, end: 480.0, label: 'a', takeawayIdx: null, verbatimExcerpt: '' },
        { start: 464.1, end: 523.0, label: 'b', takeawayIdx: null, verbatimExcerpt: '' },
      ],
      15,
      60
    );
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.start).toBe(456.1);
    expect(resolved[1]!.start).toBe(480.0); // trimmed to previous end
    expect(resolved[1]!.end).toBe(523.0);
  });

  it('drops a highlight fully contained in the previous one', () => {
    const resolved = resolveHighlightOverlaps(
      [
        { start: 100, end: 160, label: 'a', takeawayIdx: null, verbatimExcerpt: '' },
        { start: 110, end: 120, label: 'contained', takeawayIdx: null, verbatimExcerpt: '' },
      ],
      15,
      60
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.label).toBe('a');
  });

  it('drops a trimmed remainder below min duration instead of re-creating the overlap', () => {
    const resolved = resolveHighlightOverlaps(
      [
        { start: 100, end: 160, label: 'a', takeawayIdx: null, verbatimExcerpt: '' },
        { start: 155, end: 165, label: 'sliver', takeawayIdx: null, verbatimExcerpt: '' },
      ],
      15,
      60
    );
    expect(resolved).toHaveLength(1);
  });

  it('preserves non-overlapping intervals unchanged and keeps ascending order', () => {
    const input = [
      { start: 900, end: 958, label: 'later', takeawayIdx: null, verbatimExcerpt: '' },
      { start: 16, end: 33, label: 'early', takeawayIdx: null, verbatimExcerpt: '' },
    ];
    const resolved = resolveHighlightOverlaps(input, 15, 60);
    expect(resolved.map((h) => h.start)).toEqual([16, 900]);
    expect(resolved).toHaveLength(2);
  });
});