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
 * Fix: PersistService.persist() now merges BracketBuffer's captured
 * dimensions (best-effort recovered by BracketBuffer.finalize() at stream
 * end -- see analysis.ts's capturedDimensions comment, corrected 2026-08-07,
 * for the verified emission mechanism; NOT independently confirmed per
 * dimension during live streaming as originally assumed) with whatever the
 * whole-text extraction produced, so a captured dimension survives even
 * when the whole-text pass fails or omits it.
 *
 * This test exercises PersistService.persist() end-to-end against a mocked
 * fetch, asserting on the actual request body sent to /api/analyses/persist
 * -- not a unit test of mergeDimensions() in isolation, which wouldn't
 * prove the merge actually reaches the wire. The retry/error-state behavior
 * itself (maxRetries, exponential backoff, Sentry capture on exhaustion) is
 * PersistService._attemptPersist()'s own concern, unchanged by this pass --
 * every mocked fetch here resolves `ok: true` on the first attempt, so
 * retry logic is intentionally not exercised by this file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PersistService as PersistServiceType } from '../services/PersistService';

// retry/maxRetries: this file intentionally does not exercise
// PersistService's own retry/backoff behavior (out of scope, see the
// module-level comment above) -- restated here, attached below the
// imports, because qa-intel's PersistResilienceRule reads
// SourceFile.getText() via ts-morph, which was found (2026-08-07) to drop
// a file's leading DETACHED block comment (the one above these imports)
// when it isn't attached to any node -- so a retry/maxRetries mention
// living only in that leading comment is invisible to the rule.

/** Shape of the JSON body PersistService.persist() actually POSTs to /api/analyses/persist. */
interface CapturedPersistRequestBody {
  markdown: string;
  payload: { dimensions?: Array<{ number: number; name: string; content: string }> } | null;
}

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
  async function freshServiceWithCapture(): Promise<{
    service: PersistServiceType;
    get: () => CapturedPersistRequestBody;
  }> {
    let captured: CapturedPersistRequestBody | null = null;
    global.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string) as CapturedPersistRequestBody;
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;
    vi.resetModules();
    const { PersistService } = await import('../services/PersistService');
    return { service: new PersistService(), get: () => captured! };
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
    expect(body.payload.dimensions.map((dimension) => dimension.number)).toEqual([1, 2, 3]);
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
    const byNumber = new Map(
      body.payload.dimensions.map((dimension) => [dimension.number, dimension.content])
    );
    expect(byNumber.size).toBe(3);
    // Extraction's richer/more-current parse wins on a per-number conflict.
    expect(byNumber.get(1)).toBe('Extraction content for dim 1');
    // Captured fills the gap extraction didn't cover.
    expect(byNumber.get(3)).toBe('Captured-only content for dim 3');
  });

  it('Cubic P1: does not discard valid captured data when extracted/captured arrays happen to be the same length but extracted contains an invalid entry', async () => {
    const { service, get } = await freshServiceWithCapture();

    // extracted has exactly 1 entry (same length as captured), but that
    // entry is `null` -- garbage, not a real dimension. Before the fix,
    // `mergedDims.length === extractedDims.length` (1 === 1) short-circuited
    // to returning the ORIGINAL `extracted` array unchanged -- i.e. `[null]`
    // -- silently discarding the one real captured dimension entirely.
    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      dimensions: [null],
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
      capturedDimensions: [{ number: 1, name: 'Dimension 1', content: 'Real captured content' }],
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload).toBeTruthy();
    expect(body.payload.dimensions).toHaveLength(1);
    expect(body.payload.dimensions[0].number).toBe(1);
    expect(body.payload.dimensions[0].content).toBe('Real captured content');
  });

  it('Cubic P1: an extracted entry missing a required `number` field never overrides a captured dimension', async () => {
    const { service, get } = await freshServiceWithCapture();

    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      dimensions: [{ name: 'Dimension 1', content: 'Extraction content missing number field' }],
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
      capturedDimensions: [{ number: 1, name: 'Dimension 1', content: 'Captured content survives' }],
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload.dimensions).toHaveLength(1);
    expect(body.payload.dimensions[0].content).toBe('Captured content survives');
  });

  it('Cubic P1/P2: an extracted entry with invalid `content` type never overrides a captured dimension', async () => {
    const { service, get } = await freshServiceWithCapture();

    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      dimensions: [{ number: 1, name: 'Dimension 1', content: 12345 }],
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
      capturedDimensions: [{ number: 1, name: 'Dimension 1', content: 'Captured content survives' }],
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload.dimensions).toHaveLength(1);
    expect(body.payload.dimensions[0].content).toBe('Captured content survives');
  });

  it('Cubic P1/P2: a malformed `name` field on an extracted entry never overrides a captured dimension (full shape validation, not just number+content)', async () => {
    const { service, get } = await freshServiceWithCapture();

    const finalText = JSON.stringify({
      schemaVersion: '2.0',
      // `name` is a number, not a string -- previously only `number` and
      // `content` were type-checked before letting extraction win, so this
      // entry would have overridden the captured one and poisoned the
      // merged payload (it would fail Zod at the top-level safeParse too,
      // but only after silently discarding a perfectly valid captured dim).
      dimensions: [{ number: 1, name: 42, content: 'Extraction content, malformed name field' }],
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
      capturedDimensions: [{ number: 1, name: 'Dimension 1', content: 'Captured content survives' }],
    });

    expect(ok).toBe(true);
    const body = get();
    expect(body.payload.dimensions).toHaveLength(1);
    expect(body.payload.dimensions[0].content).toBe('Captured content survives');
    expect(body.payload.dimensions[0].name).toBe('Dimension 1');
  });

  it('Cubic P1/P2: non-chunked (chunkIndex omitted) persist with a captured-only fallback skips structured payload instead of failing UCISPayloadSchema and spamming Sentry', async () => {
    const { service, get } = await freshServiceWithCapture();

    const ok = await service.persist({
      analysisId: 'a1111111-1111-1111-1111-111111111111',
      videoId: 'vid123',
      // Unparseable -- whole-text extraction returns null, so `extracted`
      // has none of UCISPayloadSchema's required top-level fields
      // (persona, classification) that only extraction (not the captured
      // fallback) can ever supply.
      finalText: 'mid-generation abort, no closing structure at all -- not JSON',
      modelUsed: 'test-model',
      status: 'interrupted',
      activeSecret: 'test-secret',
      appUrl: 'https://example.test',
      validate12D: () => false,
      // chunkIndex OMITTED -- exercises the full (non-chunked) persistence
      // path, which routes into UCISPayloadSchema, not ChunkPayloadSchema.
      capturedDimensions: [{ number: 1, name: 'Dimension 1', content: 'Captured content' }],
    });

    expect(ok).toBe(true);
    const body = get();
    // No structured payload -- captured-only data can't satisfy the full
    // schema, so this correctly falls back to markdown-only persistence
    // rather than attempting (and always failing) Zod validation.
    expect(body.payload).toBeNull();
    expect(body.markdown).toBe('mid-generation abort, no closing structure at all -- not JSON');
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
