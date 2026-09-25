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

import { ExtractHighlightsUseCase, computeHarvestWindows } from '@/lib/usecases/ExtractHighlightsUseCase';
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
function makeWindowAwareCompletion(perCall = 1, failWindowFirstStarts: number[] = []) {
  const failSet = new Set(failWindowFirstStarts);
  return {
    complete: vi.fn().mockImplementation(({ user }: { user: string }) => {
      const starts = [...user.matchAll(/\[(\d+(?:\.\d+)?)\]/g)].map((m) => Number(m[1]));
      // Content-based deterministic failure: keyed on the window's FIRST
      // segment start, so the initial call AND any bounded retry both fail
      // for the same window (call-count-based mocking can't distinguish).
      if (failSet.has(starts[0] ?? -1)) return Promise.reject(new Error('window LLM down'));
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
    // Pick from BOTH window edges: proves the tail window actually
    // contributes a candidate near the video's end (the fixture picks only
    // 1 segment at the window start and 1 at the window end).
    const completion = makeWindowAwareCompletion(2);
    completion.complete.mockImplementation(({ user }: { user: string }) => {
      const starts = [...user.matchAll(/\[(\d+(?:\.\d+)?)\]/g)].map((m) => Number(m[1]));
      const picks = [starts[0], starts[starts.length - 1]].filter((start): start is number => start !== undefined).map((start) => ({
        start,
        end: start + 30,
        label: `Moment at ${start}`,
        parent_takeaway_idx: null,
      }));
      return Promise.resolve({ text: JSON.stringify(picks), model: 'test/model' });
    });
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
    const { useCase, persistence } = makeDeps(completion);    await useCase.execute({ ...baseParams });

    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number; end: number }>;
    for (let i = 1; i < saved.length; i++) {
      expect(saved[i]!.start).toBeGreaterThanOrEqual(saved[i - 1]!.end);
    }
    for (const h of saved) {
      expect(h.end).toBeGreaterThan(h.start);
    }
  });

  it('a failed window contributes nothing while other windows still persist', async () => {
    // Windows 1, 3, 5 fail deterministically (initial call AND retry).
    const windows = computeHarvestWindows(DURATION_SECONDS - 10, 300, 40).windows;
    const failedFirstStarts = [1, 3, 5].map((i) => windows[i]!.start + (10 - (windows[i]!.start % 10)) % 10);
    const completion = makeWindowAwareCompletion(3, failedFirstStarts);
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });

    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number }>;
    expect(saved.length).toBeGreaterThan(0); // partial coverage survives
    // The failed windows' ranges must contribute nothing.
    const failedRanges = [1, 3, 5].map((i) => [windows[i]!.start, windows[i]!.end]);
    for (const h of saved) {
      for (const [lo, hi] of failedRanges) {
        const insideFailedRange = h.start >= lo && h.start < hi;
        expect(insideFailedRange).toBe(false);
      }
    }
  });

  it('never replaces an existing reel with a partial harvest (PR #349 partial-overwrite RCA)', async () => {
    // Window 2 fails deterministically (initial call AND retry both fail).
    const windows = computeHarvestWindows(DURATION_SECONDS - 10, 300, 40).windows;
    const window2FirstStart = windows[2]!.start + (10 - (windows[2]!.start % 10)) % 10;
    const completion = makeWindowAwareCompletion(2, [window2FirstStart]);
    const { useCase, persistence } = makeDeps(completion);
    // An already-good reel exists for this analysis.
    persistence.findHighlightsForAnalysis.mockResolvedValue([{ idx: 0, start: 0, end: 30, label: 'existing' }]);
    await useCase.execute({ ...baseParams, skipIfPresent: false });
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('persists a partial harvest when no existing reel exists (partial beats nothing)', async () => {
    const completion = { complete: vi.fn().mockRejectedValue(new Error('LLM flaky')) };
    // One window succeeds, the rest fail after retry.
    let call = 0;
    const flakyCompletion = {
      complete: vi.fn().mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ text: JSON.stringify([{ start: 0, end: 30, label: 'm', parent_takeaway_idx: null }]), model: 'test/model' });
        }
        return Promise.reject(new Error('LLM flaky'));
      }),
    };
    const { useCase, persistence } = makeDeps(flakyCompletion);
    await useCase.execute({ ...baseParams, skipIfPresent: false });
    expect(persistence.saveHighlights).toHaveBeenCalledTimes(1);
    const saved = persistence.saveHighlights.mock.calls[0]![0].highlights as Array<{ start: number }>;
    expect(saved.length).toBeGreaterThan(0);
  });

  it('an all-windows-failed harvest persists nothing (no empty REPLACE wipe)', async () => {
    const completion = { complete: vi.fn().mockRejectedValue(new Error('LLM down')) };
    const { useCase, persistence } = makeDeps(completion);
    await useCase.execute({ ...baseParams });
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });
});

describe('computeHarvestWindows (PR #349: quota overshoot, boundary, tail coverage)', () => {
  it('distributes the quota EXACTLY across windows with no overshoot (40 over 7 windows = 40, not 42)', () => {
    // Old shape: ceil(40/7)=6 per window x 7 windows = 42 > 40 (overshoot),
    // and the final chronological slice had to cut the overshoot.
    const { windows } = computeHarvestWindows(1930, 300, 40);
    expect(windows).toHaveLength(7);
    const quotaSum = windows.reduce((sum, w) => sum + w.quota, 0);
    expect(quotaSum).toBe(40); // exact budget, no overshoot
    for (const w of windows) {
      expect(w.quota).toBeGreaterThanOrEqual(1);
      expect(w.quota).toBeLessThanOrEqual(6); // never above the ceil share
    }
  });

  it('includes a segment starting exactly at a window-count boundary (ceil() skipped it)', () => {
    // Negative control of the old bug: ceil(2100/300)=7 windows covered
    // [0,2100), so a last segment at exactly 2100s was skipped.
    const { windows } = computeHarvestWindows(2100, 300, 40);
    const lastWindow = windows[windows.length - 1]!;
    expect(lastWindow.start).toBeLessThanOrEqual(2100);
    expect(lastWindow.end).toBeGreaterThan(2100); // 2100 segment is inside
  });

  it('spreads capped windows across the full duration so the tail is covered (>3h20 videos)', () => {
    // 4h10 video: 50 natural 300s windows but only 40 (maxCount) allowed --
    // the old fixed-width cap left 12000-15000s uncovered.
    const lastStart = 15000;
    const { windows } = computeHarvestWindows(lastStart, 300, 40);
    expect(windows).toHaveLength(40);
    expect(windows[0]!.start).toBe(0);
    expect(windows[windows.length - 1]!.end).toBeGreaterThan(lastStart - 1);
    // Contiguous coverage: no gaps between consecutive windows.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.start).toBe(windows[i - 1]!.end);
    }
  });

  it('covers the full duration with contiguous windows for an uncapped video', () => {
    const lastStart = 1920;
    const { windows } = computeHarvestWindows(lastStart, 300, 40);
    expect(windows[0]!.start).toBe(0);
    expect(windows[windows.length - 1]!.end).toBeGreaterThan(lastStart);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.start).toBe(windows[i - 1]!.end);
    }
    expect(windows.reduce((sum, w) => sum + w.quota, 0)).toBe(40);
  });

  it('degrades safely on degenerate inputs', () => {
    expect(computeHarvestWindows(0, 300, 40).windows).toHaveLength(1);
    expect(computeHarvestWindows(-5, 300, 40).windows).toHaveLength(1);
    expect(computeHarvestWindows(1930, 0, 40).windows).toHaveLength(40);
    expect(computeHarvestWindows(1930, 300, NaN).windows).toHaveLength(1);
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