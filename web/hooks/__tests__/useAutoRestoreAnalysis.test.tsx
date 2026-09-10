/**
 * Component/hook-level integration test for useAutoRestoreAnalysis's
 * URL-paste auto-restore path (2026-08-07).
 *
 * Companion to
 * web/components/templates/console/__tests__/AnalysisHistory-restore.test.tsx
 * -- that file proves the history-click restore path; this one proves the
 * URL-paste auto-restore path (useAutoRestoreAnalysis.ts) produces the SAME
 * downstream store contract for the same server payload: useAnalysisStore +
 * useSynthesisNucleus hydrated, persona/knowledgeGraph/classification/
 * monetizationVerdict set exactly once, and (via useAuxElementStatus, the
 * real SSOT both the History list and Synth Console read chip state from)
 * rawAnalysisPayload/rawAnalysisPayloadId populated and tagged to the
 * restored analysisId. Both call sites existing but silently diverging is
 * exactly the bug class this branch fixes -- see AnalysisHistory.tsx's and
 * useAutoRestoreAnalysis.ts's own inline comments (cubic review, PR #177/#214).
 *
 * Renders the real hook via renderHook (not extracted logic) since the
 * restore flow is a `useEffect` closure keyed on the `url` argument -- the
 * same rationale AnalysisHistory-restore.test.tsx documents for rendering
 * the real component rather than pulling restoreAnalysis out in isolation.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts
 * and the happy-dom + RTL pattern from hooks/__tests__/useChapters.test.tsx /
 * useKnowledgeGraph.test.tsx.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { useAutoRestoreAnalysis } from '@/hooks/useAutoRestoreAnalysis';
import { useAuxElementStatus } from '@/hooks/useAuxElementStatus';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisMetadataStore } from '@/lib/stores/analysis-metadata-store';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';

// skipcq: JS-0057
vi.mock('@/lib/monitoring/sentry-utils', () => ({
  addBreadcrumb: vi.fn(),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const ANALYSIS_ID = 'analysis-autorestore-1';
const PASTED_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

// Same shape as AnalysisHistory-restore.test.tsx's ANALYSIS_PAYLOAD --
// deliberately identical field values so a diff in behavior between the two
// restore paths would show up as a diff in test outcome, not test data.
const ANALYSIS_PAYLOAD = {
  videoMetadata: { description: 'A real description', channelTitle: 'Test Channel', publishedAt: '2026-08-01T00:00:00.000Z' },
  channelMeta: { subscriberCount: 1000 },
  comments: [{ id: 'c1', text: 'great video' }],
  persona: { primary: { id: 'consultant' } },
  knowledgeGraph: { nodes: [{ id: 'n1', label: 'Node 1', type: 'concept', weight: 1, keyTerms: [] }], edges: [], rootId: null },
  classification: { recommendation: 'recommended' },
  monetizationVerdict: { consultant: 'Strong monetization potential.', creator: '', researcher: '', strategist: '' },
};

const RESTORE_RESPONSE = {
  id: ANALYSIS_ID,
  videoId: VIDEO_ID,
  title: 'Auto-Restore Flow Test Video',
  channelTitle: 'Test Channel',
  analysis_markdown: '## Dimension 1\nSome content',
  analysisStatus: 'complete',
  analysis_payload: ANALYSIS_PAYLOAD,
  model: 'claude-haiku-4-5',
  analysisAt: '2026-08-01T00:00:00.000Z',
  detectedPersona: 'consultant',
  validation_report: null,
  streaming: null,
};

function mockFetchRouter() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/analyses/check')) {
      return Promise.resolve(
        new Response(JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'complete' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    if (url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
      return Promise.resolve(
        new Response(JSON.stringify(RESTORE_RESPONSE), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    }
    if (url.includes('/api/chat/conversations')) {
      return Promise.resolve(
        new Response(JSON.stringify({ conversations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
}

describe('useAutoRestoreAnalysis URL-paste auto-restore flow', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pasting a URL with an existing analysis hydrates the same store contract as history-click restore, setting metadata exactly once', async () => {
    const fetchMock = mockFetchRouter();
    vi.stubGlobal('fetch', fetchMock);

    const setPersonaConfigSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setPersonaConfig');
    const setKnowledgeGraphSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setKnowledgeGraph');
    const setClassificationSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setClassification');
    const setMonetizationVerdictSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setMonetizationVerdict');

    const { rerender, unmount } = renderHook(({ url }) => useAutoRestoreAnalysis(url), {
      initialProps: { url: '' },
    });

    // Simulate the URL being pasted into the input box.
    rerender({ url: PASTED_URL });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/analyses/check'));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/analyses/${ANALYSIS_ID}`));
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().analysis?.id).toBe(ANALYSIS_ID);
    });
    expect(useAnalysisStore.getState().videoMetadata?.videoId).toBe(VIDEO_ID);
    expect(useAnalysisStore.getState().status).toBe('complete');

    await waitFor(() => {
      expect(useSynthesisNucleus.getState().analysis?.id).toBe(ANALYSIS_ID);
    });
    expect(useSynthesisNucleus.getState().personaConfig).toEqual(ANALYSIS_PAYLOAD.persona);
    expect(useSynthesisNucleus.getState().knowledgeGraph).toEqual(ANALYSIS_PAYLOAD.knowledgeGraph);
    expect(useSynthesisNucleus.getState().classification).toEqual(ANALYSIS_PAYLOAD.classification);
    expect(useSynthesisNucleus.getState().monetizationVerdict).toEqual(ANALYSIS_PAYLOAD.monetizationVerdict);

    // Matches AnalysisHistory-restore.test.tsx's regression guard: exactly
    // one call each, proving useAutoRestoreAnalysis's manual
    // `restoreData.analysis_payload` block (like AnalysisHistory's) is the
    // ONLY path applying these fields -- initSynthesis is never called here
    // with an `analysisPayload` field that would double-apply them.
    expect(setPersonaConfigSpy).toHaveBeenCalledTimes(1);
    expect(setKnowledgeGraphSpy).toHaveBeenCalledTimes(1);
    expect(setClassificationSpy).toHaveBeenCalledTimes(1);
    expect(setMonetizationVerdictSpy).toHaveBeenCalledTimes(1);

    // rawAnalysisPayload/rawAnalysisPayloadId: same cross-hook contract as
    // the history-click path -- useAuxElementStatus is the actual SSOT
    // consumer, driven off the analysisId+status this auto-restore just set.
    const restoredId = useAnalysisStore.getState().analysis?.id ?? null;
    const restoredStatus = useAnalysisStore.getState().status;
    const { result: auxResult, unmount: unmountAux } = renderHook(() => useAuxElementStatus(restoredId, restoredStatus));

    await waitFor(() => {
      expect(useSynthesisNucleus.getState().rawAnalysisPayloadId).toBe(restoredId);
    });
    expect(useSynthesisNucleus.getState().rawAnalysisPayload).toEqual(ANALYSIS_PAYLOAD);
    expect(auxResult.current).toEqual({ description: true, channelMeta: true, comments: true });

    unmountAux();
    unmount();
  });

  it('pasting a URL for a stale/dead analysis (check route status=error) sets error state immediately without fetching the full analysis', async () => {
    // Negative test for the early-bail guard added 2026-09-08.
    // Reproduces: analysis 32aeeb78, billing_status='processing', worker died
    // mid-stream (2/5 chunks), check route returns status='error' (row > 120s
    // old). Before the fix, the hook would enter reattach mode via
    // `restoreData.analysisStatus === 'incomplete'`, then useStreamReattach
    // would immediately fire the error — "Re-attached → 0/11 → error".
    // After the fix, the hook bails at the check-route error, sets status='error'
    // directly, and never issues the full-analysis fetch.
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'error', error: 'Analysis generation timed out. Please try again.' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      // Full-analysis fetch must NOT be called — if this branch is hit, the
      // test will still resolve (to avoid hanging), but the assertion below
      // that fetchMock was only called once will catch the regression.
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender, unmount } = renderHook(({ url }) => useAutoRestoreAnalysis(url), {
      initialProps: { url: '' },
    });

    rerender({ url: PASTED_URL });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/analyses/check'));
    });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('error');
    });

    // No missingDimensions field at all (undefined, not just empty) -- a
    // genuine total loss with no partial-recovery data to show.
    expect(useAnalysisStore.getState().error?.missingDimensions).toBeUndefined();

    // Guard: the full-analysis fetch must NOT have fired — the hook should
    // have bailed immediately after the check-route error response.
    const fullFetchCalls = fetchMock.mock.calls.filter((args: unknown[]) => {
      const url = typeof args[0] === 'string' ? args[0] : String(args[0]);
      return url.includes(`/api/analyses/${ANALYSIS_ID}`) && !url.includes('/check') && !url.includes('/status');
    });
    expect(fullFetchCalls).toHaveLength(0);

    unmount();
  });

  it('surfaces the check route error response missingDimensions field (ADR 021 Phase 2 presence-check) when bailing on a dead partial analysis', async () => {
    // Partial-chunk fixture: analysis died with 2/5 bundle chunks durably
    // completed (covering dimensions 1-5); the check route's Phase 2 field
    // reports 6-11 as still missing. The hook must surface that field
    // (console log) while keeping the early-bail contract from the test
    // above — status='error', no full-analysis fetch, no reattach.
    const MISSING_DIMENSIONS = [6, 7, 8, 9, 10, 11];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'error', error: 'Analysis generation timed out. Please try again.', missingDimensions: MISSING_DIMENSIONS }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { rerender, unmount } = renderHook(({ url }) => useAutoRestoreAnalysis(url), {
      initialProps: { url: '' },
    });

    rerender({ url: PASTED_URL });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('error');
    });

    // The presence-check field must reach observability (the Phase 2
    // surfacing contract) — passed through verbatim, no re-mapping, so
    // Phase 4 can trust the field's shape end-to-end.
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.stringContaining('dimensions still missing'),
      { missingDimensions: MISSING_DIMENSIONS },
      'auto-restore'
    );

    // 2026-09-10: real partial progress (5/11 recovered here) must ALSO
    // reach the UI, not just Sentry -- DimensionAccordion reads this to show
    // "N of 11 sections finished, completing the rest automatically" instead
    // of the same bare "Synthesis failed" a total loss gets (the live-reported
    // confusion this fix addresses, analysis 32aeeb78).
    expect(useAnalysisStore.getState().error).toMatchObject({
      code: 'ERR_ANALYSIS_PARTIAL',
      missingDimensions: MISSING_DIMENSIONS,
    });

    // Early-bail contract intact: no full-analysis fetch fired.
    const fullFetchCalls = fetchMock.mock.calls.filter((args: unknown[]) => {
      const url = typeof args[0] === 'string' ? args[0] : String(args[0]);
      return url.includes(`/api/analyses/${ANALYSIS_ID}`) && !url.includes('/check') && !url.includes('/status');
    });
    expect(fullFetchCalls).toHaveLength(0);

    unmount();
  });

  it('surfaces an empty missingDimensions array too — a fully-salvaged incident must stay distinguishable from a presence-check failure', async () => {
    // [] is a real, distinct outcome (every dimension was actually
    // salvaged) from `undefined` (the presence check never ran or itself
    // failed) -- gating the breadcrumb on `.length > 0` would collapse both
    // into "nothing logged," making a fully-salvaged incident invisible in
    // auto-restore telemetry.
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/analyses/check')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ exists: true, analysisId: ANALYSIS_ID, status: 'error', error: 'Analysis generation failed', missingDimensions: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender, unmount } = renderHook(({ url }) => useAutoRestoreAnalysis(url), {
      initialProps: { url: '' },
    });

    rerender({ url: PASTED_URL });

    await waitFor(() => {
      expect(useAnalysisStore.getState().status).toBe('error');
    });

    expect(addBreadcrumb).toHaveBeenCalledWith(
      'Analysis dead — all dimensions salvaged from completed chunks',
      { missingDimensions: [] },
      'auto-restore',
    );

    // 0 missing = nothing left to finish -- not a "partial progress" state,
    // so no ERR_ANALYSIS_PARTIAL error should be surfaced to the UI here.
    expect(useAnalysisStore.getState().error).toBeNull();

    unmount();
  });
});

