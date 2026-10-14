/**
 * ChatIntentRouter — Unit Test Suite (ADR-043 Part A)
 *
 * Covers:
 * 1. Feature flag gating (disabled -> fallback to general_grounded_qa)
 * 2. Jev Decisions API classification parsing (fetch stubbed per case)
 * 3. Follow-up turn inheritance & override confidence thresholds
 * 4. Contractual suppression flags (comments chip & timestamps)
 * 5. Fail-open resiliency on Jev 500 or timeout
 *
 * NOTE: Jev is stubbed at the fetch boundary. The label each case receives is
 * the Jev answer under test, so these assert the router's contract, not Jev's
 * classification quality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatIntentRouter } from '../services/ChatIntentRouter';

function jevOk(label: string, confidence: number) {
  return new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.13-20260917',
      answers: { intent: { type: 'choice', choice: label, confidence } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('ChatIntentRouter (ADR-043 Part A)', () => {
  const mockConfig = {
    openRouterApiKey: 'test-sk-openrouter',
    enabled: true,
    overrideConfidence: 0.75,
    timeoutMs: 15000,
  };

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Feature Flag Gating', () => {
    it('bypasses Jev classification and defaults to general_grounded_qa when disabled', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const router = new ChatIntentRouter({ ...mockConfig, enabled: false });
      const result = await router.resolveTurnIntent({
        currentMessage: 'Write a blog post about this talk',
        historyLength: 0,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.intent).toBe('general_grounded_qa');
      expect(result.isInherited).toBe(false);
      expect(result.overrideApplied).toBe(false);
      expect(result.suppressCommentsChip).toBe(false);
      expect(result.suppressTimestamps).toBe(false);
    });
  });

  describe('Intent Classification & Contract Rules', () => {
    it('classifies first turn writing request and applies contract suppression', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('writing', 0.9)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'Write an executive summary of this video for LinkedIn',
        historyLength: 0,
      });

      expect(result.intent).toBe('writing');
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
      expect(result.suppressCommentsChip).toBe(true);
      expect(result.suppressTimestamps).toBe(true);
      expect(result.isInherited).toBe(false);
    });

    it('classifies comments lookup request and preserves comments chip', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('comments_lookup', 0.9)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'What are people in the comments saying about pricing?',
        historyLength: 0,
      });

      expect(result.intent).toBe('comments_lookup');
      expect(result.suppressCommentsChip).toBe(false);
      expect(result.suppressTimestamps).toBe(false);
    });

    it('classifies citation lookup request and allows timestamps', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('citation_lookup', 0.9)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'At what timestamp does the speaker discuss GPU memory bandwidth?',
        historyLength: 0,
      });

      expect(result.intent).toBe('citation_lookup');
      expect(result.suppressTimestamps).toBe(false);
    });

    it('rejects a Jev label outside the closed set and falls back to general_grounded_qa', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('creative_writing', 0.99)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({ currentMessage: 'Write a poem', historyLength: 0 });

      expect(result.intent).toBe('general_grounded_qa');
      expect(result.isInherited).toBe(false);
    });
  });

  describe('Follow-up Turn Inheritance & Overrides (ADR-043 §A.3)', () => {
    it('inherits prior writing intent on follow-up when override confidence is below threshold', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('general_grounded_qa', 0.6)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'Make it more punchy and add one paragraph',
        priorIntent: 'writing',
        historyLength: 2,
      });

      expect(result.intent).toBe('writing');
      expect(result.isInherited).toBe(true);
      expect(result.overrideApplied).toBe(false);
      expect(result.suppressCommentsChip).toBe(true);
      expect(result.suppressTimestamps).toBe(true);
    });

    it('overrides prior writing intent when user explicitly switches topic with high confidence', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevOk('comments_lookup', 0.9)));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'Now show me the top audience questions from the comments',
        priorIntent: 'writing',
        historyLength: 2,
      });

      expect(result.intent).toBe('comments_lookup');
      expect(result.isInherited).toBe(false);
      expect(result.overrideApplied).toBe(true);
      expect(result.priorIntent).toBe('writing');
      expect(result.suppressCommentsChip).toBe(false);
    });
  });

  describe('Fault Tolerance & Fail-Open Resilience (ADR-043 §A.7)', () => {
    it('falls back to prior intent or general_grounded_qa on Jev Decisions API 500 error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
      const router = new ChatIntentRouter(mockConfig);
      const result = await router.resolveTurnIntent({
        currentMessage: 'Explain the core thesis',
        priorIntent: 'general_grounded_qa',
        historyLength: 1,
      });

      expect(result.intent).toBe('general_grounded_qa');
      expect(result.isInherited).toBe(true);
    });

    it('falls back gracefully without throwing when Jev Decisions request times out', async () => {
      // Fetch never resolves on its own; only the router's abort signal ends it.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
        ),
      );
      const router = new ChatIntentRouter({ ...mockConfig, timeoutMs: 20 });
      const result = await router.resolveTurnIntent({
        currentMessage: 'Give me a brief breakdown',
        historyLength: 0,
      });

      expect(result.intent).toBe('general_grounded_qa');
      expect(result.isInherited).toBe(false);
    });
  });
});
