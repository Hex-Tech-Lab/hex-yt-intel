import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateExecutiveDigestUseCase } from '../GenerateExecutiveDigestUseCase';
import { ExtractHighlightsUseCase } from '../ExtractHighlightsUseCase';
import { ReconcileHighlightsUseCase } from '../ReconcileHighlightsUseCase';
import * as settingsAdapter from '@/lib/adapters/SupabaseSettingsAdapter';

// RCA (2026-09-07, live "No highlights yet" report): the finalize-time
// highlights webhook never has real takeaways (the digest doesn't exist yet
// at that point), so its extraction prompt is always told "0 takeaways" and
// -- per the prompt's own documented rule -- always returns zero highlights,
// silently (an empty result is never persisted). GenerateExecutiveDigestUseCase
// is the only place real takeaways become available afterward, but it used
// to ONLY call ReconcileHighlightsUseCase, which itself no-ops whenever there
// is nothing yet to reconcile (`if (highlights.length === 0) return;`) --
// exactly the state left by the always-empty webhook. Net effect: highlights
// stayed permanently empty for every analysis that went through this path.
//
// These tests assert the fix's *routing decision* (backfill vs reconcile),
// not ExtractHighlightsUseCase's/ReconcileHighlightsUseCase's own internals
// (those have their own test coverage) -- via prototype spies.

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: {
    getRegistrySettings: vi.fn().mockResolvedValue({ 'digest.maxOutputTokens': 3000 }),
  },
}));

const DIGEST_COMPLETION_TEXT = `
#### 0.1 Snapshot
A short snapshot.

#### 0.2 Overview
A short overview.

#### 0.3 Key Takeaways
- First real takeaway
- Second real takeaway
`;

function makePorts(overrides: Partial<Record<string, any>> = {}) {
  return {
    verifyOwnership: vi.fn().mockResolvedValue({
      analysis_markdown: '# Analysis\nSome real content.',
      analysis_payload: null,
      executive_digest: null,
      video_id: 'video-abc',
    }),
    saveExecutiveDigest: vi.fn().mockResolvedValue(true),
    getTranscriptSegments: vi.fn().mockResolvedValue([{ start: 0, text: 'hello world' }]),
    saveHighlights: vi.fn().mockResolvedValue(true),
    saveReconciliation: vi.fn().mockResolvedValue(true),
    findHighlightsForAnalysis: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCompletion() {
  return {
    complete: vi.fn().mockResolvedValue({ text: DIGEST_COMPLETION_TEXT, model: 'test-model' }),
  };
}

async function flushMicrotasks() {
  // The post-digest backfill/reconcile call is fire-and-forget (not awaited
  // by execute()) so digest generation stays fast -- poll briefly for it.
  await vi.waitFor(() => {}, { timeout: 500, interval: 5 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('GenerateExecutiveDigestUseCase — post-digest highlights backfill routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsAdapter.SupabaseSettingsAdapter.getRegistrySettings).mockResolvedValue({
      'digest.maxOutputTokens': 3000,
    });
  });

  it('runs a full ExtractHighlightsUseCase backfill when no highlights exist yet', async () => {
    const persistence = makePorts({ findHighlightsForAnalysis: vi.fn().mockResolvedValue([]) });
    const completion = makeCompletion();

    const extractSpy = vi.spyOn(ExtractHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);
    const reconcileSpy = vi.spyOn(ReconcileHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);

    const useCase = new GenerateExecutiveDigestUseCase(persistence as any, completion as any);
    const result = await useCase.execute({ analysisId: 'a1', userId: 'u1', models: [] as any });

    expect(result.type).toBe('success');
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'a1',
        videoId: 'video-abc',
        skipIfPresent: false,
        takeaways: expect.arrayContaining(['First real takeaway', 'Second real takeaway']),
      })
    );
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('still routes to ReconcileHighlightsUseCase when highlights already exist', async () => {
    const persistence = makePorts({
      findHighlightsForAnalysis: vi.fn().mockResolvedValue([
        { idx: 0, start: 0, end: 10, label: 'x' },
      ]),
    });
    const completion = makeCompletion();

    const extractSpy = vi.spyOn(ExtractHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);
    const reconcileSpy = vi.spyOn(ReconcileHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);

    const useCase = new GenerateExecutiveDigestUseCase(persistence as any, completion as any);
    await useCase.execute({ analysisId: 'a2', userId: 'u1', models: [] as any });

    await flushMicrotasks();

    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: 'a2', userId: 'u1' })
    );
    expect(extractSpy).not.toHaveBeenCalled();
  });
});
