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

  it('retries a raw network-level fetch rejection the same way a 5xx retries (P0a, PR #313 post-merge review)', async () => {
    // Pre-fix, a rejected fetch (TypeError: Failed to fetch — a dropped
    // connection, the incident's exact failure mode) skipped the bounded
    // retry schedule entirely and relied on the online-event handler.
    // It must enter the SAME 5s/10s schedule a 500 does.
    seedAnalysis('analysis-kg-netreject');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-netreject'));

    // Same cadence as the 5xx test above: attempt 1 immediate, retries at 5s/10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.graph.nodes.length).toBe(1);
    unmount();
  });

  it('enters the retry schedule via the request timeout when a fetch never settles (P0b, PR #313 post-merge review)', async () => {
    // Pre-fix, a stalled-but-never-rejecting fetch blocked the await
    // forever — the retry logic is gated on the fetch promise settling, so
    // it could never run. The AbortController timeout must convert the
    // hang into a retryable failure on the same schedule.
    seedAnalysis('analysis-kg-timeout');
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      // Simulates a stalled connection: never settles on its own, only
      // rejects when the hook's AbortController fires.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-timeout'));

    // Attempt 1: timeout abort at 10s -> 5s retry wait -> attempt 2 at ~15s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);

    // Attempt 3 (t≈35s) and attempt 4 (t≈60s) — the last budgeted attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Attempt 4's own timeout fires (~t=70s): budget exhausted, failure surfaced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.loading).toBe(false);

    // A timeout failure is in the retryable bucket: the online last resort
    // fires one more attempt, which is itself bounded by the same timeout
    // (it rejects ~10s later instead of hanging forever).
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    unmount();
  });

  it('clears the failure flag on success so later online events do not refetch (P1a, PR #313 post-merge review)', async () => {
    // Pre-fix, lastAttemptFailed was only ever set to true (in the catch)
    // and never reset on success — one failed attempt made EVERY subsequent
    // 'online' event re-fire a redundant fetch forever.
    seedAnalysis('analysis-kg-p1a');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-p1a'));

    // Attempt 1 rejects; the 5s-scheduled retry succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The successful recovery cleared the flag: a later online event (and
    // a second one) must be a no-op.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

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

describe('useKnowledgeGraph deep payload validation end-to-end (PR #315 review round 2 item 6)', () => {
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
      title: 'Deep validation test',
      dimensions: {},
    });
  }

  it('a shallowly-valid but item-invalid payload ({entities:[{}]}) is rejected as retryable and retried — not silently mapped with undefined ids', async () => {
    seedAnalysis('analysis-kg-deep-validation');
    const okBody = { entities: [{ id: 'e1', label: 'Transformer', type: 'concept', weight: 3 }], relations: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ entities: [{}], relations: [] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-deep-validation'));

    // Attempt 1: shallow-valid body, invalid item → retryable → retry after 5s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.graph.nodes.length).toBe(1);
    expect(result.current.graph.nodes[0].id).toBe('e1');
    unmount();
  });

  it('a mixed valid/invalid payload rejects the WHOLE payload (no partial graph with undefined ids)', async () => {
    seedAnalysis('analysis-kg-mixed-invalid');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      entities: [{ id: 'e1', label: 'Ok', type: 'concept', weight: 1 }, { label: 'missing id' }],
      relations: [],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useKnowledgeGraph('analysis-kg-mixed-invalid'));

    // All attempts reject; budget exhausts → loading settles false, no
    // partial graph was ever set.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.loading).toBe(false);
    expect(result.current.graph.nodes.length).toBe(0);
    unmount();
  });
});
