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
});
