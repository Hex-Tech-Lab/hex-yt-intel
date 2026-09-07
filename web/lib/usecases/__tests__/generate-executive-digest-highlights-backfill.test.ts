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

// `after()` requires a real Next.js request scope, which doesn't exist in a
// unit test -- stub it to invoke its callback immediately (still async, so
// the caller's own await/flush behavior is exercised the same way).
vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    void cb();
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
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
  // The recovery call runs inside a mocked `after()` (invoked synchronously
  // in tests, see the next/server mock above) but the callback itself is
  // still async -- one macrotask tick is enough for it to settle.
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
        skipIfPresent: true,
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

  it('runs the backfill on a CACHED digest hit too, not just fresh generation (regression: review finding 2026-09-07)', async () => {
    // This is the exact real-world case the original bug report hit: an
    // analysis whose digest was already generated (and cached) before this
    // fix landed, but whose highlights are still empty from the always-
    // empty finalize-time webhook. A version of this fix that only checked
    // on fresh generation would never help these already-existing analyses.
    const persistence = makePorts({
      verifyOwnership: vi.fn().mockResolvedValue({
        analysis_markdown: '# Analysis\nSome real content.',
        analysis_payload: null,
        executive_digest: {
          snapshot: 'cached snapshot',
          overview: 'cached overview',
          takeaways: ['Cached takeaway one', 'Cached takeaway two'],
          model: 'test-model',
          generatedAt: new Date().toISOString(),
        },
        video_id: 'video-cached',
      }),
      findHighlightsForAnalysis: vi.fn().mockResolvedValue([]),
    });
    const completion = makeCompletion();

    const extractSpy = vi.spyOn(ExtractHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);
    const reconcileSpy = vi.spyOn(ReconcileHighlightsUseCase.prototype, 'execute').mockResolvedValue(undefined);

    const useCase = new GenerateExecutiveDigestUseCase(persistence as any, completion as any);
    const result = await useCase.execute({ analysisId: 'a3', userId: 'u1', models: [] as any });

    expect(result.type).toBe('success');
    expect(result.type === 'success' && result.cached).toBe(true);
    // The digest completion must NOT have been called for a cache hit.
    expect(completion.complete).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'a3',
        videoId: 'video-cached',
        skipIfPresent: true,
        takeaways: expect.arrayContaining(['Cached takeaway one', 'Cached takeaway two']),
      })
    );
    expect(reconcileSpy).not.toHaveBeenCalled();
  });
});
