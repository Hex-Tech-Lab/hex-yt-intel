/**
 * Component-level integration test for AnalysisHistory's history-click
 * restore flow (2026-08-07).
 *
 * A Cubic review on the chip-state-sync branch flagged that the underlying
 * aux-status logic (web/lib/utils/aux-status-from-report.ts,
 * web/lib/__tests__/aux-status-from-report.test.ts) was tested at the pure-
 * function level, but nothing proved the real UI restore flow -- clicking a
 * history row -> fetch -> store hydration -- actually works end-to-end, or
 * that the persona/knowledgeGraph/classification/monetizationVerdict
 * metadata fields land exactly once. AnalysisHistory.tsx's restoreAnalysis
 * (see its own inline comments) calls `initSynthesis({...})` WITHOUT an
 * `analysisPayload` field, then separately sets persona/knowledgeGraph/
 * classification/monetizationVerdict from `data.analysis_payload` -- this
 * guards against synthesis-nucleus-store.ts's `initializeAnalysis` ALSO
 * auto-applying those fields internally when `payload.analysisPayload` is
 * present (which would double-apply them if both paths fired).
 *
 * Renders the real AnalysisHistory component (mounting it directly rather
 * than extracting the restore logic) because restoreAnalysis is a closure
 * over component state (loadingId, latestRestoreRequestRef) that the actual
 * click handler exercises -- extracting it would only re-prove the pure
 * fetch-then-set logic already covered by aux-status-from-report.test.ts,
 * not that clicking a real row in the real component drives the real path.
 *
 * Uses createElement instead of JSX, per WordCloud.test.tsx's documented
 * workaround for the oxc/rolldown parser issue with tsconfig's
 * "jsx": "preserve" in vitest 8 (2026-08-06).
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisMetadataStore } from '@/lib/stores/analysis-metadata-store';
import { useAuxElementStatus } from '@/hooks/useAuxElementStatus';
import { useChatStore } from '@/store/useChatStore';
import { useInputStore } from '@/store/useInputStore';
import { useVideoStore } from '@/store/useVideoStore';

// AnalysisHistory reads TOTAL_DIMENSIONS via useTotalDimensions() ->
// useAdminSettings() -> useSettings(), which throws outside a real
// <SettingsProvider> (itself a network-backed provider pulling in useAuth +
// fetchAdminSettings -- out of scope for this restore-flow test). Stubbing
// useAdminSettings to return null lets the config layer's own documented
// defaults (DEFAULT_TOTAL_DIMENSIONS etc.) apply, same as an unauthenticated
// first paint in production.
vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: () => null,
  useUserSettings: () => null,
  useSettings: () => ({ adminSettings: null, userSettings: null, isLoading: false, error: null }),
}));

const HISTORY_ITEM = {
  baseVideoId: 'vid-restore-1',
  analysisId: 'analysis-restore-1',
  title: 'Restore Flow Test Video',
  channelTitle: 'Test Channel',
  firstAnalyzedAt: '2026-08-01T00:00:00.000Z',
  lastAnalyzedAt: '2026-08-01T00:00:00.000Z',
  lastViewedAt: null,
  timesAnalyzed: 1,
  views: 1,
  bestDimensions: 11,
  presentDimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  missingDimensions: [],
  status: 'complete' as const,
  hasDigest: true,
  hasDescription: true,
  hasChannelMeta: true,
  hasComments: true,
  hasChapters: true,
  clientPlatform: null,
};

// Realistic analysis_payload shape matching AuxStatusPayloadInput plus the
// rich-metadata fields (persona/knowledgeGraph/classification/
// monetizationVerdict) restoreAnalysis reads from `data.analysis_payload`.
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
  id: 'analysis-restore-1',
  videoId: 'vid-restore-1',
  title: 'Restore Flow Test Video',
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
    if (url.includes('/api/analyses/overview')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [HISTORY_ITEM] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
    }
    if (url.includes(`/api/analyses/${HISTORY_ITEM.analysisId}`)) {
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

describe('AnalysisHistory restore flow (real component, real click)', () => {
  beforeEach(() => {
    useAnalysisStore.getState().clearAnalysis();
    useSynthesisNucleus.getState().reset();
    useChatStore.getState().reset();
    useVideoStore.getState().reset();
    useInputStore.setState({ url: '', isValid: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clicking a history row hydrates rawAnalysis + synthesis nucleus, and sets persona/KG/classification/monetization exactly once', async () => {
    const fetchMock = mockFetchRouter();
    vi.stubGlobal('fetch', fetchMock);

    const setPersonaConfigSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setPersonaConfig');
    const setKnowledgeGraphSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setKnowledgeGraph');
    const setClassificationSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setClassification');
    const setMonetizationVerdictSpy = vi.spyOn(useAnalysisMetadataStore.getState(), 'setMonetizationVerdict');

    render(createElement(AnalysisHistory));

    // Wait for useHistoryOverview's initial fetch to resolve and the row to render.
    const row = await screen.findByText('Restore Flow Test Video');

    fireEvent.click(row);

    // The restore fetch itself.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/analyses/${HISTORY_ITEM.analysisId}`));
    });

    // Downstream store hydration -- the actual bug class under test: history-
    // click restore must land the analysis in useAnalysisStore + the
    // synthesis nucleus exactly like the URL-paste auto-restore path does.
    await waitFor(() => {
      expect(useAnalysisStore.getState().analysis?.id).toBe('analysis-restore-1');
    });
    expect(useAnalysisStore.getState().videoMetadata?.videoId).toBe('vid-restore-1');
    expect(useAnalysisStore.getState().status).toBe('complete');

    await waitFor(() => {
      expect(useSynthesisNucleus.getState().analysis?.id).toBe('analysis-restore-1');
    });
    expect(useSynthesisNucleus.getState().personaConfig).toEqual(ANALYSIS_PAYLOAD.persona);
    expect(useSynthesisNucleus.getState().knowledgeGraph).toEqual(ANALYSIS_PAYLOAD.knowledgeGraph);
    expect(useSynthesisNucleus.getState().classification).toEqual(ANALYSIS_PAYLOAD.classification);
    expect(useSynthesisNucleus.getState().monetizationVerdict).toEqual(ANALYSIS_PAYLOAD.monetizationVerdict);

    // The regression guard: each metadata setter must fire exactly once.
    // Before the fix this branch resolved, `initSynthesis({...})` and the
    // manual `data.analysis_payload` block could BOTH apply these fields if
    // `analysisPayload` were ever passed into initSynthesis's payload --
    // this pins the current (correct) call count so that regression can't
    // silently return.
    expect(setPersonaConfigSpy).toHaveBeenCalledTimes(1);
    expect(setKnowledgeGraphSpy).toHaveBeenCalledTimes(1);
    expect(setClassificationSpy).toHaveBeenCalledTimes(1);
    expect(setMonetizationVerdictSpy).toHaveBeenCalledTimes(1);

    // History-click restore doesn't populate rawAnalysisPayload/
    // rawAnalysisPayloadId directly -- useAuxElementStatus (the actual
    // SSOT consumer both the History list and Synth Console read chip
    // state from) does, triggered off the analysisId+status this restore
    // just set. Mounting it here proves the real cross-hook contract this
    // whole branch exists to fix: whichever screen restored the analysis,
    // useAuxElementStatus ends up with the SAME rawAnalysisPayload, tagged
    // to the SAME analysisId.
    const restoredId = useAnalysisStore.getState().analysis?.id ?? null;
    const restoredStatus = useAnalysisStore.getState().status;
    const { result: auxResult, unmount: unmountAux } = renderHook(() => useAuxElementStatus(restoredId, restoredStatus));

    await waitFor(() => {
      expect(useSynthesisNucleus.getState().rawAnalysisPayloadId).toBe(restoredId);
    });
    expect(useSynthesisNucleus.getState().rawAnalysisPayload).toEqual(ANALYSIS_PAYLOAD);
    expect(auxResult.current).toEqual({ description: true, channelMeta: true, comments: true });

    unmountAux();
  });
});
