/**
 * History-row thumbnail fade test (mockup v2, user decision 2026-09-30).
 *
 * The mockup (docs/agent-prompts/2026-09-30-history-thumbnail-mockup-v2.html)
 * specifies a three-layer stack inside each history row:
 *   z-0  image layer  — pinned right, full row height at 16:9, fading out to
 *                       the left over the --hx-thumb-fade CSS variable
 *   z-1  divider      — drawn ON TOP of the image
 *   z-10 content      — title/chips above everything, text-shadowed
 *
 * This pins the DOM contract so a refactor can't silently flatten the stack
 * or hardcode the fade length back into JSX. Styling itself (mask-image,
 * width calc) lives in globals.css and is covered by the CSS-level
 * assertions here plus lib/__tests__/radius-tokens.test.ts-style parsing.
 *
 * Uses createElement instead of JSX, per AnalysisHistory-restore.test.tsx's
 * documented workaround for the oxc/rolldown parser issue with tsconfig's
 * "jsx": "preserve" in vitest 8 (2026-08-06).
 */

// @vitest-environment happy-dom

import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';

vi.mock('@/lib/stores/settings-context', () => ({
  useAdminSettings: () => null,
  useUserSettings: () => null,
  useSettings: () => ({ adminSettings: null, userSettings: null, isLoading: false, error: null }),
}));

const HISTORY_ITEM = {
  baseVideoId: 'abcdefghijk', // valid 11-char video id shape
  analysisId: 'analysis-thumb-1',
  title: 'Thumbnail Fade Test Video',
  channelTitle: 'Test Channel',
  firstAnalyzedAt: '2026-09-01T00:00:00.000Z',
  lastAnalyzedAt: '2026-09-01T00:00:00.000Z',
  lastViewedAt: null,
  timesAnalyzed: 1,
  views: 1,
  bestDimensions: 11,
  presentDimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  missingDimensions: [],
  status: 'complete' as const,
  failureReason: null,
  hasDigest: true,
  hasDescription: true,
  hasChannelMeta: true,
  hasComments: true,
  hasChapters: true,
  hasHighlights: true,
  durationSeconds: 754,
  clientPlatform: null,
};

const ANALYSIS_PAYLOAD = {
  videoMetadata: { description: 'A real description', channelTitle: 'Test Channel', publishedAt: '2026-09-01T00:00:00.000Z' },
  channelMeta: { subscriberCount: 1000 },
  comments: [],
  persona: { primary: { id: 'consultant' } },
  knowledgeGraph: { nodes: [], edges: [], rootId: null },
  classification: { recommendation: 'recommended' },
  monetizationVerdict: { consultant: '', creator: '', researcher: '', strategist: '' },
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
        new Response(JSON.stringify({
          id: HISTORY_ITEM.analysisId,
          videoId: HISTORY_ITEM.baseVideoId,
          title: HISTORY_ITEM.title,
          channelTitle: 'Test Channel',
          analysis_markdown: '## Dimension 1\nSome content',
          analysisStatus: 'complete',
          analysis_payload: ANALYSIS_PAYLOAD,
          model: 'claude-haiku-4-5',
          analysisAt: '2026-09-01T00:00:00.000Z',
          detectedPersona: 'consultant',
          validation_report: null,
          streaming: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

describe('AnalysisHistory thumbnail fade (mockup v2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchRouter());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders image layer, divider, and content in the right stacking order', async () => {
    render(createElement(AnalysisHistory));

    const title = await screen.findByText('Thumbnail Fade Test Video');
    const content = title.closest('.hx-thumb-content');
    expect(content).not.toBeNull();

    const row = content!.parentElement;
    expect(row).not.toBeNull();
    expect(row!.classList.contains('hx-history-row')).toBe(true);

    // Layer 1 (bottom): the image layer, absolutely positioned.
    const thumbLayer = row!.querySelector('[data-testid="hx-thumb-layer"]');
    expect(thumbLayer).not.toBeNull();
    expect(thumbLayer!.className).toContain('hx-thumb-layer');

    // The vertical divider was removed (user decision 2026-09-30).
    expect(row!.querySelector('[data-testid="hx-thumb-divider"]')).toBeNull();

    // Layer 3 (top): content column above everything. happy-dom doesn't
    // apply the Tailwind stylesheet, so assert the utility classes rather
    // than computed z-index values.
    expect(content!.className).toContain('z-10');
    expect(thumbLayer!.className).toContain('z-0');
  });

  it('uses the CSS variable for the fade (no magic number in JSX) and the 3cm default in globals.css', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', '..', 'app', 'globals.css'), 'utf-8');
    expect(css).toMatch(/--hx-thumb-fade:\s*3cm/);
    expect(css).toMatch(/mask-image:\s*linear-gradient\(to left, #000 calc\(100% - var\(--hx-thumb-fade\)\),[^;]*transparent 100%\)/);
    // The JSX applies the fade classes but never an inline fade length.
    const source = readFileSync(join(__dirname, '..', 'AnalysisHistory.tsx'), 'utf-8');
    expect(source).toContain('hx-thumb-layer');
    expect(source).not.toMatch(/\b3cm\b/);
  });

  it('(#377 review) the text column reserves the sharp image width and the whole layer carries the shadow', () => {
    const css = readFileSync(join(__dirname, '..', '..', '..', '..', 'app', 'globals.css'), 'utf-8');
    const block = css.match(/\.hx-thumb-content \{[^}]*\}/)?.[0] ?? '';
    expect(block).toMatch(/padding-right:\s*calc\(var\(--hx-thumb-sharp\)/);
    expect(block).toMatch(/text-shadow:/);
    expect(css).not.toMatch(/\.hx-thumb-divider/);
    expect(css).toMatch(/\.hx-thumb-layer[\s\S]*?width:\s*calc\(var\(--hx-thumb-sharp\) \+ var\(--hx-thumb-fade\)\)/);
  });

  it('chip-row containers carry NO mask (letters must never fade — only the thumbnail layer fades)', () => {
    const source = readFileSync(join(__dirname, '..', 'AnalysisHistory.tsx'), 'utf-8');
    // No mask-image class may appear anywhere in the component; the only
    // fade lives on .hx-thumb-layer in globals.css.
    expect(source).not.toMatch(/mask-image/);

    const css = readFileSync(join(__dirname, '..', '..', '..', '..', 'app', 'globals.css'), 'utf-8');
    // The fade mask belongs to the thumbnail layer only.
    const layerBlock = css.match(/\.hx-thumb-layer \{[^}]*\}/)?.[0] ?? '';
    expect(layerBlock).toMatch(/mask-image:\s*linear-gradient\(to left/);
    // And no text/content rule carries a mask.
    expect(css.match(/\.hx-thumb-content \{[^}]*\}/)?.[0] ?? '').not.toMatch(/mask-image/);
    expect(css.match(/\.hx-halo[^{]*\{[^}]*\}/)?.[0] ?? '').not.toMatch(/mask-image/);
    expect(css.match(/\.hx-chip-shadow[^{]*\{[^}]*\}/)?.[0] ?? '').not.toMatch(/mask-image/);
  });
});
