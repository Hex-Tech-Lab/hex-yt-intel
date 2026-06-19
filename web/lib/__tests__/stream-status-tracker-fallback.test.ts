/**
 * StreamStatusTracker — Bundle fallback state preservation.
 * Verifies that during fallback, global state (persona, knowledgeGraph,
 * classification, monetizationVerdict) is preserved for dimensions NOT
 * in the fallback bundle, and only bundle-owned dimensions are cleared.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { StreamStatusTracker } from '@/lib/adapters/stream-status-tracker';

describe('StreamStatusTracker — Bundle fallback state preservation', () => {
  let tracker: StreamStatusTracker;

  beforeEach(() => {
    // Reset stores
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: {
          1: { number: 1, name: 'Dimension 1', content: 'Dim 1 content' },
          6: { number: 6, name: 'Dimension 6', content: 'Dim 6 content' },
          7: { number: 7, name: 'Dimension 7', content: 'Dim 7 content' },
          8: { number: 8, name: 'Dimension 8', content: 'Dim 8 content' },
        },
        streaming: {
          dimensionsReceived: [1, 6, 7, 8],
        },
      },
      personaConfig: { primary: { id: 'creator', label: 'Creator', weight: 0.5 }, cognitiveLenses: [], selectionRationale: 'test' },
      knowledgeGraph: {
        nodes: [{ id: 'N1', label: 'Node 1', dimension: 1, weight: 1, polarity: 0.5, keyTerms: [], entityType: 'concept', content: 'Node content' }],
        edges: [],
        rootId: 'N1',
      },
      classification: { authoritative: true, recommendation: 'test', practicallyActionable: true, knowledgeGraphReady: true, safe: true },
      monetizationVerdict: { verdict: 'monetizable', confidence: 0.8 },
    });

    useAnalysisStore.setState({
      analysis: {
        id: 'test-analysis',
        video_id: 'test-video',
        analysis_markdown: '# Test Markdown',
        created_at: new Date().toISOString(),
      },
    });

    tracker = new StreamStatusTracker();
  });

  it('preserves global state for excluded dimensions during bundle fallback', () => {
    // Fallback for bundle [6, 7] — should NOT clear dimensions 1, 8 or global state
    tracker.handleStatus(
      { type: 'status', stage: 'fallback', error: 'ERR_MODEL_OVERLOAD' },
      { dimensions: [6, 7] },  // bundle includes 6, 7 only
      () => {},  // resetRawSink
      () => {},  // rebuildMarkdown
    );

    const state = useSynthesisNucleus.getState();

    // Dimensions 1 and 8 (not in bundle) should be preserved
    expect(state.analysis?.dimensions[1]).toBeDefined();
    expect(state.analysis?.dimensions[1]?.content).toBe('Dim 1 content');
    expect(state.analysis?.dimensions[8]).toBeDefined();
    expect(state.analysis?.dimensions[8]?.content).toBe('Dim 8 content');

    // Global state should be preserved (not cleared)
    expect(state.personaConfig).not.toBeNull();
    expect(state.knowledgeGraph).not.toBeNull();
    expect(state.classification).not.toBeNull();
    expect(state.monetizationVerdict).not.toBeNull();
  });

  it('clears only bundle-owned dimensions during bundle fallback', () => {
    tracker.handleStatus(
      { type: 'status', stage: 'fallback', error: 'ERR_MODEL_OVERLOAD' },
      { dimensions: [6, 7] },  // bundle includes 6, 7
      () => {},
      () => {},
    );

    const state = useSynthesisNucleus.getState();

    // Dimensions 6 and 7 (in bundle) should be cleared
    expect(state.analysis?.dimensions[6]).toBeUndefined();
    expect(state.analysis?.dimensions[7]).toBeUndefined();

    // Dimensions 1 and 8 (not in bundle) should survive
    expect(state.analysis?.dimensions[1]).toBeDefined();
    expect(state.analysis?.dimensions[8]).toBeDefined();
  });

  it('clears ALL global state during full fallback (undefined dimensions)', () => {
    tracker.handleStatus(
      { type: 'status', stage: 'fallback', error: 'ERR_MODEL_REFUSAL' },
      {},  // no dimensions option = full fallback
      () => {},
      () => {},
    );

    const state = useSynthesisNucleus.getState();

    // All dimensions should be cleared
    expect(Object.keys(state.analysis?.dimensions || {})).toHaveLength(0);

    // Global state should also be cleared in full fallback
    expect(state.personaConfig).toBeNull();
    expect(state.knowledgeGraph).toBeNull();
    expect(state.classification).toBeNull();
    expect(state.monetizationVerdict).toBeNull();
  });

  it('clears dimensionsReceived for excluded dimensions', () => {
    tracker.handleStatus(
      { type: 'status', stage: 'fallback', error: 'ERR_MODEL_OVERLOAD' },
      { dimensions: [6, 7] },
      () => {},
      () => {},
    );

    const state = useSynthesisNucleus.getState();
    const received = state.analysis?.streaming?.dimensionsReceived || [];

    // Dimensions 6 and 7 should be removed from received
    expect(received).not.toContain(6);
    expect(received).not.toContain(7);

    // Dimensions 1 and 8 should remain
    expect(received).toContain(1);
    expect(received).toContain(8);
  });
});
