/**
 * Regression test for useKnowledgeGraph client-side TF-IDF fallback not
 * firing reliably (ADR 023, 2026-08-06).
 *
 * The fallback was hard-gated behind apiFetchDone — the /api/analyses/[id]/graph
 * round-trip, which queries kg_entities/kg_relations (empty DB-wide for
 * these analyses). This test verifies that when both the persisted graph
 * route AND the API return empty, the client-side TF-IDF synthesis from
 * dimension content actually runs and produces nodes.
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

describe('useKnowledgeGraph client-side fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    useSynthesisNucleus.getState().reset();
    vi.useRealTimers();
  });

  it('loads and transitions loading state when API returns empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entities: [], relations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'analysis-kg-fallback',
      videoId: 'vid1',
      title: 'No KG test',
      dimensions: {
        1: { number: 1, name: 'Apex Intelligence', content: 'Key entity: transformer architecture. Mentioned: GPT, BERT, attention mechanism. Summary: deep learning advances.' },
        2: { number: 2, name: 'Core Analysis', content: 'Core technology stack uses Python and PyTorch. The PyTorch library is popular for deep learning research and production.' },
        8: { number: 8, name: 'Semantic', content: 'Relevant entities: transformer, attention, GPT, BERT, RNN. The model architecture is encoder-decoder with attention mechanism.' },
      },
    });

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-fallback'));

    // Advance timers to allow the fetch promise to resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    // Post-review finding (2026-08-06): the original version of this test
    // only asserted loading===false and that fetch was called -- it would
    // have passed even if the fallback synthesis were completely broken
    // (produced zero nodes). The actual claim in this test's own header --
    // "the client-side TF-IDF synthesis... actually runs and produces
    // nodes" -- was never verified. Assert it directly.
    expect(result.current.graph.nodes.length).toBeGreaterThan(0);
    expect(result.current.ready).toBe(true);
    // Sanity: nodes should carry real content derived from the seeded
    // dimensions above, not an empty/placeholder synthesis result.
    expect(result.current.graph.nodes.some((node) => node.content.length > 0)).toBe(true);

    unmount();
  });

  it('tags API-sourced nodes with a numeric dimension (regression, 2026-08-07 nav-remount entity-seek RCA)', async () => {
    // kg_entities has no `dimension` column (see
    // supabase/migrations/20260610110000_add_knowledge_graph_tables.sql) --
    // nodes from this API path previously carried `dimension: undefined`.
    // DashboardContainer's handleSelectNode calls
    // useAnalysisDimensionsStore.getDimension(node.dimension), which returns
    // undefined for a non-numeric input by construction, so every click on
    // one of these nodes fell into the "wait 15s for a dimension that will
    // never stream in" retry branch -- a real, permanently-silent entity-seek
    // no-op for any node sourced from a populated kg_entities table.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }],
          relations: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'analysis-kg-api-nodes',
      videoId: 'vid2',
      title: 'API-sourced KG nodes test',
      dimensions: {},
    });

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-api-nodes'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.graph.nodes.length).toBe(1);
    expect(typeof result.current.graph.nodes[0].dimension).toBe('number');
    expect(Number.isFinite(result.current.graph.nodes[0].dimension)).toBe(true);

    unmount();
  });

  it('preserves the real dimension from raw_node when present (Cubic PR #217 P1 finding)', async () => {
    // persistGraph() stores the original GraphNode losslessly in `raw_node`
    // (SupabasePersistenceAdapter.persistGraph -- `rawNode: n`), which DOES
    // carry the entity's real dimension even though the flat `kg_entities`
    // row does not. The fix must prefer raw_node.dimension over the sentinel
    // fallback -- otherwise every API-sourced node seeks against Dimension 8
    // regardless of where it actually came from (silently WRONG, not just a
    // no-op).
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entities: [
            { id: 'e1', label: 'Transformer', type: 'concept', weight: 3, raw_node: { dimension: 3 } },
            { id: 'e2', label: 'No metadata', type: 'concept', weight: 1 },
          ],
          relations: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'analysis-kg-raw-node',
      videoId: 'vid3',
      title: 'raw_node dimension preservation test',
      dimensions: {},
    });

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-raw-node'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.graph.nodes.length).toBe(2);
    const withRawNode = result.current.graph.nodes.find((node) => node.id === 'e1');
    const withoutRawNode = result.current.graph.nodes.find((node) => node.id === 'e2');
    // Real dimension preserved from raw_node, NOT the DEFAULT_KG_EXTRACTION_DIMENSION sentinel.
    expect(withRawNode?.dimension).toBe(3);
    // No recoverable dimension anywhere -- sentinel fallback is still correct here.
    expect(withoutRawNode?.dimension).toBe(8);

    unmount();
  });
});

describe('useKnowledgeGraph fetch resilience (2026-09-15 incident RCA, video rDhaCLrdWHk)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    useSynthesisNucleus.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function seedAnalysis(id: string) {
    useSynthesisNucleus.getState().initializeAnalysis({
      id,
      videoId: `${id}-video`,
      title: 'Fetch resilience test',
      dimensions: {},
    });
  }

  it('retries a transient 5xx with backoff and renders the graph when a retry succeeds', async () => {
    seedAnalysis('analysis-kg-retry-5xx');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"Internal server error"}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{"error":"Internal server error"}', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-retry-5xx'));

    // Attempt 1 fires immediately (500), retry 1 after 5s, retry 2 after 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.graph.nodes.length).toBe(1);
    unmount();
  });

  it('does not retry a 4xx response (permanent by nature)', async () => {
    seedAnalysis('analysis-kg-retry-404');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Analysis not found"}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-retry-404'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    unmount();
  });

  it('re-arms the fetch on the online event after all retries exhausted during an outage', async () => {
    seedAnalysis('analysis-kg-retry-online');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Internal server error"}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-retry-online'));

    // Exhaust the bounded retry budget: attempt + 3 retries at 5s/10s/15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const attemptsAfterExhaustion = fetchMock.mock.calls.length;
    expect(attemptsAfterExhaustion).toBe(4);

    // Network returns: exactly one more attempt, bounded by the real event.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock.mock.calls.length).toBe(attemptsAfterExhaustion + 1);

    unmount();
  });

  it('enabled flipping false->true (entitlements resolve after mount) triggers the fetch that the [analysisId]-only deps previously skipped', async () => {
    // Second, independent first-load root cause confirmed in the same RCA:
    // useEffectiveViewMode is 'simple' while entitlements load (defaultFree
    // has canAccessKnowledgeGraph=false), so `enabled` starts false and
    // flips true a moment later — but the fetch effect's dependency array
    // was [analysisId] only, so the flip never (re)fired and ADR 023-style
    // rows (empty payload knowledgeGraph) rendered no WordCloud panel at
    // all for the whole session.
    seedAnalysis('analysis-kg-enabled-flip');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    // Mount with enabled=false — the exact fresh-load sequence.
    const { result, rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useKnowledgeGraph('analysis-kg-enabled-flip', enabled),
      { initialProps: { enabled: false } }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Entitlements resolve -> enabled flips true -> fetch must fire now.
    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.graph.nodes.length).toBe(1);

    unmount();
  });
});
