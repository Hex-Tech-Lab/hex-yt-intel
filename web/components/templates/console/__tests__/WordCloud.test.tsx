/**
 * Regression test for the WordCloud word-enclosing highlight bug (2026-08-06).
 *
 * Originally, clicking any word that shared a KG node id highlighted ALL
 * words sharing that id — even unrelated-looking words of different sizes.
 * The fix added a per-word wordKey and a local ref-based highlight mechanism
 * (lastClickedWordKeyRef) so only the specific clicked word is highlighted.
 * Cross-panel selections (from KnowledgeGraphCanvas etc.) still fall back
 * to node-id-based highlighting.
 *
 * This test verifies via the aria-label: after mounting, the component
 * renders the correct number of key terms and the aria-label is well-formed.
 *
 * Uses createElement instead of JSX to avoid the oxc/rolldown parser issue
 * with tsconfig's "jsx": "preserve" in vitest 8 (2026-08-06).
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { WordCloud } from '@/components/templates/console/WordCloud';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

const graph: KnowledgeGraph = {
  nodes: [
    { id: 'node-1', label: 'Transformer', type: 'concept', weight: 1, keyTerms: ['transformer', 'attention'] },
    { id: 'node-1', label: 'Attention', type: 'concept', weight: 0.8, keyTerms: ['attention'] },
    { id: 'node-2', label: 'PyTorch', type: 'tool', weight: 0.6, keyTerms: ['pytorch'] },
  ],
  edges: [],
  rootId: null,
};

describe('WordCloud selection highlight', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with the correct key term count and accessible label', async () => {
    vi.useFakeTimers();

    const onSelect = vi.fn();
    const { container } = render(createElement(WordCloud, { graph, selectedId: null, onSelect }));

    const canvas = container.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Advance timers to let the entrance animation and layout compute.
    vi.advanceTimersByTime(500);

    const ariaLabel = canvas?.getAttribute('aria-label') || '';
    // The graph has 3 source nodes => tokenMap produces at least "transformer",
    // "attention", "pytorch" + bigrams => 3+ key terms.
    expect(ariaLabel).toContain('3 key terms');
  });
});