/**
 * ExtractHighlightsUseCase -- the standalone highlights-extraction path
 * decoupled from the digest pass (RCA 2026-08-23). Covers the behaviors that
 * were silent no-ops or data-loss paths before the decoupling:
 *  - skipIfPresent short-circuit (avoid re-spend on an analysis the finalize
 *    path already covered -- the idempotency that lets a re-publish re-run
 *    safely).
 *  - empty/expired transcript -> silent no-op (no LLM call, no save).
 *  - unparseable model response -> does NOT wipe an existing set.
 *  - happy path -> saveHighlights with idx mapping.
 *  - a failing existence-read must not block a fresh extraction attempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SupabaseSettingsAdapter.getRegistrySettings so the use case's registry
// fetch returns the fallback constants without hitting Supabase. Must be
// hoisted before the use case import (vi.mock is auto-hoisted).
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn().mockResolvedValue({
      'highlights.maxCount': 40,
      'highlights.maxOutputTokens': 6000,
      'highlights.segmentDurationSeconds': 10,
      'highlights.contextLeadSeconds': 2.5,
    }),
  },
}));

import { ExtractHighlightsUseCase } from '@/lib/usecases/ExtractHighlightsUseCase';
import { HIGHLIGHTS_REGISTRY_FALLBACK } from '@/lib/utils/highlights-settings';

const SEGMENTS = [
  { start: 0, text: 'Intro' },
  { start: 10, text: 'First claim' },
  { start: 20, text: 'Reveal' },
  { start: 30, text: 'Outro' },
];

const VALID_HIGHLIGHTS_JSON = JSON.stringify([
  { start: 10, end: 20, label: 'First claim moment' },
  { start: 20, end: 30, label: 'The reveal' },
]);

type PersistenceSpy = {
  getTranscriptSegments: ReturnType<typeof vi.fn>;
  saveHighlights: ReturnType<typeof vi.fn>;
  findHighlightsForAnalysis: ReturnType<typeof vi.fn>;
};

const makeDeps = (opts: {
  existing?: Array<{ idx: number; start: number; end: number; label: string }>;
  segments?: Array<{ start: number; text: string }> | null;
  completion?: string;
  findThrows?: boolean;
}) => {
  const persistence: PersistenceSpy = {
    getTranscriptSegments: vi.fn().mockResolvedValue(opts.segments === undefined ? SEGMENTS : opts.segments),
    saveHighlights: vi.fn().mockResolvedValue(true),
    findHighlightsForAnalysis: opts.findThrows
      ? vi.fn().mockRejectedValue(new Error('postgres down'))
      : vi.fn().mockResolvedValue(opts.existing ?? []),
  };
  const completion = {
    complete: vi.fn().mockResolvedValue({ text: opts.completion ?? VALID_HIGHLIGHTS_JSON, model: 'test/model' }),
  };
  return {
    useCase: new ExtractHighlightsUseCase(persistence as never, completion as never),
    persistence,
    completion,
  };
};

const baseParams = {
  analysisId: 'an-1',
  videoId: 'vid-1',
  models: [{ model: 'test/model' }] as const,
};

describe('ExtractHighlightsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skipIfPresent short-circuits when highlights already exist (no LLM call, no save)', async () => {
    const { useCase, persistence, completion } = makeDeps({
      existing: [{ idx: 0, start: 10, end: 20, label: 'already here' }],
    });
    await useCase.execute({ ...baseParams });
    expect(persistence.findHighlightsForAnalysis).toHaveBeenCalledWith('an-1');
    expect(persistence.getTranscriptSegments).not.toHaveBeenCalled();
    expect(completion.complete).not.toHaveBeenCalled();
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('proceeds to extraction when no existing highlights are present', async () => {
    const { useCase, persistence, completion } = makeDeps({ existing: [] });
    await useCase.execute({ ...baseParams });
    expect(persistence.getTranscriptSegments).toHaveBeenCalledWith('vid-1');
    expect(completion.complete).toHaveBeenCalledTimes(1);
    expect(persistence.saveHighlights).toHaveBeenCalledTimes(1);
  });

  it('no-ops without an LLM call when the transcript is missing/expired', async () => {
    const { useCase, persistence, completion } = makeDeps({ segments: null });
    await useCase.execute({ ...baseParams });
    expect(completion.complete).not.toHaveBeenCalled();
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('no-ops without an LLM call when the transcript has zero segments', async () => {
    const { useCase, persistence, completion } = makeDeps({ segments: [] });
    await useCase.execute({ ...baseParams });
    expect(completion.complete).not.toHaveBeenCalled();
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('does NOT save on an unparseable model response (leaves existing untouched)', async () => {
    const { useCase, persistence } = makeDeps({ completion: 'not json at all' });
    await useCase.execute({ ...baseParams });
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('does NOT save when the model returns a valid-but-empty array (no wipe)', async () => {
    // The data-loss guard: a read failure (findThrows) falls through to
    // extraction, and if the LLM then returns [] the atomic replace must NOT
    // wipe a pre-existing valid set. Skipping the empty save leaves the table
    // as-is regardless of whether the existence check succeeded.
    const { useCase, persistence } = makeDeps({ findThrows: true, completion: '[]' });
    await useCase.execute({ ...baseParams });
    expect(persistence.saveHighlights).not.toHaveBeenCalled();
  });

  it('persists parsed highlights with sequential idx mapping on the happy path', async () => {
    const { useCase, persistence } = makeDeps({});
    await useCase.execute({ ...baseParams });
    expect(persistence.saveHighlights).toHaveBeenCalledWith({
      analysisId: 'an-1',
      highlights: [
        { idx: 0, start: 10, end: 20, label: 'First claim moment', takeawayIdx: null, verbatimExcerpt: 'First claim' },
        { idx: 1, start: 20, end: 30, label: 'The reveal', takeawayIdx: null, verbatimExcerpt: 'Reveal' },
      ],
    });
  });

  it('a failing existence-read does not block a fresh extraction attempt', async () => {
    const { useCase, persistence, completion } = makeDeps({ findThrows: true });
    await useCase.execute({ ...baseParams });
    // Fell through to extraction despite findHighlightsForAnalysis throwing.
    expect(persistence.getTranscriptSegments).toHaveBeenCalled();
    expect(completion.complete).toHaveBeenCalledTimes(1);
    expect(persistence.saveHighlights).toHaveBeenCalledTimes(1);
  });

  it('skipIfPresent=false forces extraction even when highlights already exist', async () => {
    const { useCase, persistence, completion } = makeDeps({
      existing: [{ idx: 0, start: 10, end: 20, label: 'stale' }],
    });
    await useCase.execute({ ...baseParams, skipIfPresent: false });
    expect(persistence.findHighlightsForAnalysis).not.toHaveBeenCalled();
    expect(completion.complete).toHaveBeenCalledTimes(1);
    expect(persistence.saveHighlights).toHaveBeenCalledTimes(1);
  });

  it('uses the registry-resolved maxCount/maxOutputTokens (not hardcoded)', async () => {
    const { SupabaseSettingsAdapter } = await import('@/lib/adapters/SupabaseSettingsAdapter');
    const { useCase, completion } = makeDeps({});
    await useCase.execute({ ...baseParams });
    const call = completion.complete.mock.calls[0][0];
    // System prompt embeds the registry maxCount (40) as the ceiling.
    expect(call.system).toContain(String(HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxCount']));
    expect(call.maxTokens).toBe(HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxOutputTokens']);
    expect(SupabaseSettingsAdapter.getRegistrySettings).toHaveBeenCalledWith(
      [
        'highlights.maxCount',
        'highlights.maxOutputTokens',
        'highlights.minSegmentDurationSeconds',
        'highlights.maxSegmentDurationSeconds',
      ],
      HIGHLIGHTS_REGISTRY_FALLBACK
    );
  });
});
