import { describe, it, expect } from 'vitest';
import { parseHighlightsExtraction, buildHighlightsExtractionSystemPrompt } from './highlights-extraction';

/**
 * Regression coverage for the 2026-08-20 uncap fix (live user report --
 * see 20260820120000_highlights_reel_uncap_settings.sql). Prior behavior
 * hard-capped at a local MAX_HIGHLIGHTS=12 constant regardless of the
 * caller; now the cap is an explicit `maxHighlights` parameter sourced from
 * the Settings Registry (`highlights.maxCount`).
 */
describe('parseHighlightsExtraction', () => {
  function makeStarts(count: number): Set<number> {
    return new Set(Array.from({ length: count }, (_unused, i) => i * 10));
  }

  it('keeps more than the old hardcoded 12-item cap when maxHighlights allows it', () => {
    const validStarts = makeStarts(40);
    const items = Array.from({ length: 30 }, (_unused, i) => ({
      start: i * 10,
      end: (i + 1) * 10,
      label: `Moment ${i}`,
    }));
    const text = JSON.stringify(items);

    const result = parseHighlightsExtraction(text, validStarts, 40);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.highlights.length).toBe(30); // NOT clamped to 12
    }
  });

  it('still enforces whatever maxHighlights ceiling is passed in', () => {
    const validStarts = makeStarts(40);
    const items = Array.from({ length: 30 }, (_unused, i) => ({
      start: i * 10,
      end: (i + 1) * 10,
      label: `Moment ${i}`,
    }));
    const text = JSON.stringify(items);

    const result = parseHighlightsExtraction(text, validStarts, 5);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.highlights.length).toBe(5);
    }
  });

  it('does not wipe an existing set on an unparseable response', () => {
    const result = parseHighlightsExtraction('not json at all', makeStarts(5), 40);
    expect(result.status).toBe('invalid');
  });

  it('drops a fabricated timestamp that is not a real segment start', () => {
    const validStarts = makeStarts(3); // 0, 10, 20
    const text = JSON.stringify([{ start: 5, end: 10, label: 'fabricated' }]);
    const result = parseHighlightsExtraction(text, validStarts, 40);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.highlights.length).toBe(0);
    }
  });
});

describe('buildHighlightsExtractionSystemPrompt', () => {
  it('embeds the given maxCount as the hard ceiling, not a fixed target', () => {
    const prompt = buildHighlightsExtractionSystemPrompt(40);
    expect(prompt).toContain('40');
    expect(prompt).not.toMatch(/between \d+ and \d+ moments/);
  });
});
