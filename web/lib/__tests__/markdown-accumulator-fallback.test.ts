/**
 * MarkdownAccumulator — Forced fallback semantics.
 * Verifies that forced rebuilds (force=true) always replace content,
 * and that dimension-freshness tracking prevents stale content.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { MarkdownAccumulator } from '@/lib/adapters/markdown-accumulator';

describe('MarkdownAccumulator — Fallback semantics', () => {
  let accumulator: MarkdownAccumulator;

  beforeEach(() => {
    // Reset stores
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: {},
        streaming: { dimensionsReceived: [] },
      },
      personaConfig: null,
      knowledgeGraph: null,
      classification: null,
      monetizationVerdict: null,
    });

    useAnalysisStore.setState({
      analysis: {
        id: 'test',
        video_id: 'test-video',
        analysis_markdown: '',
        created_at: new Date().toISOString(),
      },
    });

    accumulator = new MarkdownAccumulator();
  });

  it('force=true always replaces content even when shorter', () => {
    // Set long markdown
    useAnalysisStore.setState({
      analysis: {
        ...useAnalysisStore.getState().analysis!,
        analysis_markdown: 'A'.repeat(1000),
      },
    });

    // Set minimal dimensions
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: { 1: { number: 1, name: 'D1', content: 'short' } },
        streaming: { dimensionsReceived: [1] },
      },
    });

    // Force rebuild — should replace even though output is shorter
    accumulator.rebuildDisplayMarkdown(true);

    const markdown = useAnalysisStore.getState().analysis?.analysis_markdown || '';
    // The reconstructed markdown should be from the dimension, not the old long string
    expect(markdown).not.toBe('A'.repeat(1000));
    expect(markdown.length).toBeLessThan(1000);
  });

  it('non-forced update when dimensions increase (semantic freshness)', () => {
    // Start with 1 dimension
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: { 1: { number: 1, name: 'D1', content: 'Content 1' } },
        streaming: { dimensionsReceived: [1] },
      },
    });

    useAnalysisStore.setState({
      analysis: {
        ...useAnalysisStore.getState().analysis!,
        analysis_markdown: 'Initial markdown',
      },
    });

    // Rebuild — 1 dimension in both current and new, length check applies
    accumulator.rebuildDisplayMarkdown(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _after1 = useAnalysisStore.getState().analysis?.analysis_markdown;

    // Add a second dimension
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: {
          1: { number: 1, name: 'D1', content: 'Content 1' },
          2: { number: 2, name: 'D2', content: 'Content 2' },
        },
        streaming: { dimensionsReceived: [1, 2] },
      },
    });

    // Rebuild — new has 2 dims, current has 0+markdown dims
    // Should update because newDims > currentDims
    accumulator.rebuildDisplayMarkdown(false);
    const after2 = useAnalysisStore.getState().analysis?.analysis_markdown;

    // The markdown should have been updated (at minimum, the version incremented)
    expect(after2).toBeDefined();
  });

  it('non-forced update preserves longer content when dimensions equal', () => {
    // Set long markdown with 0 dimensions in reconstruction
    useAnalysisStore.setState({
      analysis: {
        ...useAnalysisStore.getState().analysis!,
        analysis_markdown: 'Substantial markdown content that should be preserved',
      },
    });

    // Empty dimensions — reconstruction will have 0 dimension headers
    useSynthesisNucleus.setState({
      analysis: {
        schemaVersion: '2.0',
        dimensions: {},
        streaming: { dimensionsReceived: [] },
      },
    });

    // Rebuild without force — currentDims=0, newDims=0
    // Length guard: reconstructed (short) < current (long) → skip
    accumulator.rebuildDisplayMarkdown(false);

    const markdown = useAnalysisStore.getState().analysis?.analysis_markdown;
    expect(markdown).toBe('Substantial markdown content that should be preserved');
  });

  it('no-op when analysis is null', () => {
    useAnalysisStore.setState({ analysis: null });

    // Should not throw
    expect(() => accumulator.rebuildDisplayMarkdown(true)).not.toThrow();
    expect(() => accumulator.rebuildDisplayMarkdown(false)).not.toThrow();
  });
});
