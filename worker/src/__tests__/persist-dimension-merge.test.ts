/**
 * ADR 021 Phase 1 regression test.
 *
 * RCA (2026-08-07, see docs/specs/ADR_021_...): the whole-text extraction
 * path (extractJsonPayload + jsonrepair in PersistService.persist()) is
 * all-or-nothing -- a single malformed trailing dimension (mid-generation
 * abort, unescaped char, etc.) can make jsonrepair fail entirely, which
 * previously discarded every dimension in that persist attempt even when
 * most of them were individually complete and valid. Confirmed live via
 * Supabase: multiple real `analyses` rows with billing_status='failed' and
 * dimension_count=0 despite a non-empty analysis_markdown -- the raw text
 * survived (finalText fallback) but the structured per-dimension payload
 * did not.
 *
 * Fix: PersistService.persist() now merges BracketBuffer's incrementally
 * captured dimensions (each confirmed independently, the instant its own
 * closing brace streamed in -- see analysis.ts's capturedDimensions) with
 * whatever the whole-text extraction produced, so a captured dimension
 * survives even when the whole-text pass fails or omits it.
 *
 * This test exercises PersistService.persist() end-to-end against a mocked
 * fetch, asserting on the actual request body sent to /api/analyses/persist
 * -- not a unit test of mergeDimensions() in isolation, which wouldn't
 * prove the merge actually reaches the wire.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ADR 021 Phase 1: PersistService dimension-level persistence', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // PersistService.ts captures `const rawFetch = fetch;` at module top-level
  // -- stubbing global.fetch AFTER that module has already been imported
  // (e.g. in a beforeEach) has no effect, since the module's closure already
  // holds the old reference. Stub first, then re-import fresh via
  // vi.resetModules() so the module re-captures the stub.
  async function freshServiceWithCapture(): Promise<{ service: any; get: () => any }> {
    let captured: any = null;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      captured = JSON.parse(init.body as string);
      return { ok: true, status: 200 } as Response;
    }) as any;
    vi.resetModules();
    const { PersistService } = await import('../services/PersistService');
    return { service: new PersistService(), get: () => captured };
  }

  it('falls back entirely to captured dimensions when finalText is unparseable garbage', async () => {
    const { service, get } = await freshServiceWithCapture();

    // finalText deliberately unrecoverable -- no JSON object at all, so
    // extractJsonPayload returns null before jsonrepair even gets a chance.
    // Without the merge fix, jsonPayload would stay null and every captured
    // dimension would be lost even though BracketBuffer already confirmed
    // 3 complete dimensions during streaming.
    const ok = await service.persist({
      analysisId: 'a1111111-1111-1111-1111-111111111111',
      videoId: 'vid123',
      finalText: 'mid-generation abort, no closing structure at all -- not JSON',
      modelUsed: 'test-model',
      status: 'interrupted',
      activeSecret: 'test-secret',
      appUrl: 'https://example.test',
      validate12D: () => false,
      chunkIndex: 1,
      totalChunks: 5,
      capturedDimensions: [
        { number: 1, name: 'Dimension 1', content: 'Complete content for dim 1' },
        { number: 2, name: 'Dimension 2', content: 'Complete content for dim 2' },
        { number: 3, name: 'Dimension 3', content: 'Complete content for dim 3' },
      ],
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload).toBeTruthy();
    expect(body.payload.dimensions).toHaveLength(3);
    expect(body.payload.dimensions.map((d: any) => d.number)).toEqual([1, 2, 3]);
    // The reconstructed markdown must actually contain the captured content,
    // not just the raw unparseable finalText -- proves reconstructMarkdown
    // ran against the merged/fallback payload, not the original garbage.
    expect(body.markdown).toContain('Complete content for dim 1');
  });

  it('merges captured dimensions with a partially-successful whole-text extraction, extraction wins on overlap', async () => {
    const { service, get } = await freshServiceWithCapture();

    // finalText has a valid JSON object covering dims 1-2 (whole-text
    // extraction succeeds for these), but BracketBuffer separately captured
    // dims 1-3 during streaming (dim 3 arrived after the point finalText's
    // JSON was cut off in this synthetic scenario -- exercises the "fill
    // the gap" side of the merge, not just the total-failure fallback).
    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      dimensions: [
        { number: 1, name: 'Dimension 1', content: 'Extraction content for dim 1' },
        { number: 2, name: 'Dimension 2', content: 'Extraction content for dim 2' },
      ],
    });

    const ok = await service.persist({
      analysisId: 'a1111111-1111-1111-1111-111111111111',
      videoId: 'vid123',
      finalText,
      modelUsed: 'test-model',
      status: 'interrupted',
      activeSecret: 'test-secret',
      appUrl: 'https://example.test',
      validate12D: () => false,
      chunkIndex: 1,
      totalChunks: 5,
      capturedDimensions: [
        { number: 1, name: 'Dimension 1', content: 'STALE captured content for dim 1' },
        { number: 3, name: 'Dimension 3', content: 'Captured-only content for dim 3' },
      ],
    });

    expect(ok).toBe(true);
    const body = get();
    const byNumber = new Map(body.payload.dimensions.map((d: any) => [d.number, d.content]));
    expect(byNumber.size).toBe(3);
    // Extraction's richer/more-current parse wins on a per-number conflict.
    expect(byNumber.get(1)).toBe('Extraction content for dim 1');
    // Captured fills the gap extraction didn't cover.
    expect(byNumber.get(3)).toBe('Captured-only content for dim 3');
  });

  it('is a no-op when there are no captured dimensions (existing behavior unchanged)', async () => {
    const { service, get } = await freshServiceWithCapture();

    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      dimensions: [{ number: 1, name: 'Dimension 1', content: 'Only extraction content' }],
    });

    const ok = await service.persist({
      analysisId: 'a1111111-1111-1111-1111-111111111111',
      videoId: 'vid123',
      finalText,
      modelUsed: 'test-model',
      status: 'completed',
      activeSecret: 'test-secret',
      appUrl: 'https://example.test',
      validate12D: () => true,
      chunkIndex: 1,
      totalChunks: 5,
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload.dimensions).toHaveLength(1);
    expect(body.payload.dimensions[0].content).toBe('Only extraction content');
  });
});
