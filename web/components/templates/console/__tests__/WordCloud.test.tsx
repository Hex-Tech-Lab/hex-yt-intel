/**
 * Regression test for the WordCloud word-enclosing highlight bug (2026-08-06).
 *
 * Originally, clicking any word that shared a KG node id highlighted ALL
 * words sharing that id — even unrelated-looking words of different sizes.
 * The fix added a per-word wordKey and a local ref-based highlight mechanism
 * (lastClickedWordKeyRef, now state -- see WordCloud.tsx's own comments) so
 * only the specific clicked word is highlighted; cross-panel selections
 * (from KnowledgeGraphCanvas etc.) still fall back to node-id-based
 * highlighting, since we don't know which specific word the other panel
 * meant.
 *
 * Post-review finding (2026-08-06): the original version of this test never
 * actually clicked a word or asserted highlight state -- it only checked the
 * key-term count in the aria-label, which would still pass even if the
 * original clustering bug were fully reintroduced. This version tests both
 * halves of the actual contract:
 *   1. A local click selects exactly one word (via onSelect + the
 *      selected-count reflected in the accessible label).
 *   2. An externally-driven selectedId (simulating a cross-panel selection)
 *      falls back to highlighting every word sharing that node id.
 *
 * Uses createElement instead of JSX to avoid the oxc/rolldown parser issue
 * with tsconfig's "jsx": "preserve" in vitest 8 (2026-08-06).
 *
 * Follows the test-header convention from lib/__tests__/useChaptersStore.test.ts.
 */

// @vitest-environment happy-dom

import { createElement } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { WordCloud } from '@/components/templates/console/WordCloud';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

// Two words ("Transformer", "Attention") deliberately share node-1's id --
// this is the exact "many words, one node" shape that caused the original
// clustering bug. A third word ("PyTorch") on a distinct node-2 acts as a
// control that should never be affected by clicks on node-1's words.
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
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic layout: the placement spiral starts each word at
    // angle = Math.random() * 2*PI, radius = 0 for the first placement
    // attempt. Pinning Math.random() to 0 means the highest-weight word
    // (sorted first) is placed exactly at the canvas center on its first
    // attempt, giving this test a real, predictable click target instead
    // of guessing at randomized coordinates.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders with the correct key term count and accessible label', () => {
    const onSelect = vi.fn();
    const { container } = render(createElement(WordCloud, { graph, selectedId: null, onSelect }));

    const canvas = container.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    vi.advanceTimersByTime(500);

    const ariaLabel = canvas?.getAttribute('aria-label') || '';
    // The graph has 3 source nodes => tokenMap produces at least "transformer",
    // "attention", "pytorch" + bigrams => 3+ key terms.
    expect(ariaLabel).toContain('3 key terms');
  });

  it('clicking one word selects only that word, not the sibling sharing its node id', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(createElement(WordCloud, { graph, selectedId: null, onSelect }));
    const canvas = container.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;

    // happy-dom's canvas has no real layout engine -- getBoundingClientRect
    // returns all-zeros, so stub it with a plausible rect matching the
    // component's default size (320x220, see WordCloud.tsx's initial state)
    // so the click-to-canvas-coordinate math in getWordAtCoords resolves to
    // real numbers instead of NaN.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 320, bottom: 220, width: 320, height: 220, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    vi.advanceTimersByTime(500); // let entrance animation + layout settle

    // With Math.random() pinned to 0, the highest-weight word ("Transformer",
    // weight 1, sorted first) is placed at the canvas center (160, 110).
    fireEvent.click(canvas, { clientX: 160, clientY: 110 });

    expect(onSelect).toHaveBeenCalledWith('node-1');

    // WordCloud is a controlled component: the actual highlight (and the
    // ARIA label reflecting it) depends on `selectedId` FLOWING BACK IN as
    // a prop, same as a real parent (DashboardContainer.handleSelectNode)
    // would do in response to onSelect. This is the real contract, not a
    // test simplification -- WordCloud has no internal "am I selected at
    // all" concept independent of the selectedId prop; what stays purely
    // internal is WHICH SPECIFIC WORD gets highlighted once selectedId
    // matches this component's own last click.
    rerender(createElement(WordCloud, { graph, selectedId: 'node-1', onSelect }));
    vi.advanceTimersByTime(500);
    const ariaLabel = canvas?.getAttribute('aria-label') || '';
    // Exactly ONE term selected (the specific word clicked), not two --
    // if the original bug were reintroduced, both "Transformer" and
    // "Attention" (sharing node-1) would highlight and this would read
    // "2 terms selected" instead.
    expect(ariaLabel).toContain('1 term selected');
  });

  it('an externally-driven selectedId (cross-panel selection) highlights every word sharing that node id', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(createElement(WordCloud, { graph, selectedId: null, onSelect }));
    const canvas = container.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;

    vi.advanceTimersByTime(500);

    // Simulate KnowledgeGraphCanvas/MindMap selecting node-1 externally --
    // this component doesn't know which specific mention was meant, so
    // BOTH words sharing node-1 ("Transformer", "Attention") should
    // highlight, unlike the single-word case above.
    rerender(createElement(WordCloud, { graph, selectedId: 'node-1', onSelect }));
    vi.advanceTimersByTime(500);

    const ariaLabel = canvas?.getAttribute('aria-label') || '';
    expect(ariaLabel).toContain('2 terms selected');
  });
});
