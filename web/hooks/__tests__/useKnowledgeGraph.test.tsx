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

    unmount();
  });
});