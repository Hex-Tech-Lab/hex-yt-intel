/**
 * CPU regression + bench harness for BracketBuffer's multi-feed streaming path.
 *
 * Incident (2026-09-23, exceededCpu on Free plan): when the model emits ANY
 * leading text before the JSON envelope (the common "```json\n{...}" fence),
 * BracketBuffer.feed() sliced the buffer at objectStart and reset scanIndex to
 * 0 while keeping depth/inString/escaped at their END-of-scan state. Every
 * subsequent feed() therefore:
 *   1. Rescanned the ENTIRE accumulated buffer from index 0 -> O(n^2) total
 *      character iterations across a full ~100 KB / ~20k-token response fed
 *      in token-sized deltas (~4000 feeds). On the Free plan's 10 ms CPU
 *      budget this alone killed the request (outcome: exceededCpu).
 *   2. Re-counted braces with already-accumulated depth -> depth inflated by
 *      ~1 per feed, so depth never returned to 0, the envelope NEVER emitted
 *      during streaming, and finalize()'s repair path became the only
 *      fragment source.
 *
 * Bench: replays a realistic fixture (11 dimensions, ~20k tokens) through
 * feed() in token-sized chunks and reports wall-time + scan cost per stage.
 * The scan-iteration counter is derived algebraically (chunk count x average
 * rescanned prefix) -- no production code instrumentation needed.
 */
import { describe, it, expect } from 'vitest';
import { BracketBuffer } from '../services/BracketBuffer';

const DIMENSIONS = 11;
const WORDS_PER_DIM = 1200; // ~1200 words x 11 dims ~ 20k tokens total envelope

function buildWords(seed: number, count: number): string {
  const base = [
    'the', 'analysis', 'of', 'audience', 'retention', 'signals', 'shows', 'that', 'narrative', 'pacing',
    'directly', 'shapes', 'viewer', 'behaviour', 'across', 'formats', 'and', 'community', 'engagement',
    'patterns', 'emerge', 'when', 'creators', 'respond', 'to', 'comments', 'with', 'structured',
    'follow', 'up', 'videos', 'because', 'early', 'hooks', 'determine', 'whether', 'viewers', 'stay',
  ];
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(base[(i * 7 + seed) % base.length]);
  return words.join(' ');
}

/** Realistic v2.0 envelope with a leading ```json fence (the bug trigger). */
function buildFixture(dimensions = DIMENSIONS, wordsPerDim = WORDS_PER_DIM): string {
  const dims: string[] = [];
  for (let d = 1; d <= dimensions; d++) {
    dims.push(
      `{"number":${d},"name":"Dimension ${d}","content":"${buildWords(d, wordsPerDim).replace(/"/g, '')}"}`,
    );
  }
  return '```json\n' + `{"schemaVersion":"2.0","dimensions":[${dims.join(',')}]}`;
}

/** Token-sized SSE deltas, like OpenRouter's streaming chunks. */
function chunkify(text: string, chunkSize = 24): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks;
}

describe('BracketBuffer multi-feed CPU regression (Free-plan exceededCpu, 2026-09-23)', () => {
  it('emits all dimensions in feed() across many chunked feeds, with a leading fence, and depth stays bounded', () => {
    const bb = new BracketBuffer();
    const fixture = buildFixture(3, 40); // small fixture for the correctness check
    const chunks = chunkify(fixture);

    let dimensionFragments = 0;
    let maxDepth = 0;
    for (const chunk of chunks) {
      bb.feed(chunk).forEach((f) => {
        if (f.type === 'dimension') dimensionFragments++;
      });
      maxDepth = Math.max(maxDepth, bb.getState().depth);
    }

    // FIXED behavior: the envelope closes in feed() on the final chunk.
    expect(dimensionFragments).toBe(3);
    // FIXED behavior: depth must reflect real nesting (envelope + array = 2),
    // not the old code's ~+1-per-feed unbounded inflation (hundreds for a
    // realistic stream). Generous bound: anything <= 10 is clearly bounded.
    expect(maxDepth).toBeLessThanOrEqual(10);
  });

  it('finalize() after a full clean stream (no truncation) must not lose the final dimension', () => {
    const bb = new BracketBuffer();
    const fixture = buildFixture(2, 20);
    for (const chunk of chunkify(fixture)) bb.feed(chunk);
    // Envelope's closing "}" is in the last chunk, so feed() already emitted.
    // finalize() on an empty buffer is a no-op -- nothing lost, nothing doubled.
    expect(bb.finalize()).toHaveLength(0);
  });
});

describe('BracketBuffer CPU bench (~20k-token Haiku response, token-sized deltas)', () => {
  it('streams the full fixture and reports wall time + scan cost', () => {
    const fixture = buildFixture();
    const chunks = chunkify(fixture);
    const bb = new BracketBuffer();

    const t0 = performance.now();
    let fragments = 0;
    for (const chunk of chunks) {
      fragments += bb.feed(chunk).length;
    }
    const feedMs = performance.now() - t0;
    const t1 = performance.now();
    const fin = bb.finalize();
    const finalizeMs = performance.now() - t1;

    // Algebraic scan cost: old code rescans the whole accumulated buffer every
    // feed => iterations ~ feeds * avgPrefix; fixed code scans each char once.
    const avgPrefix = fixture.length / 2;
    const oldScanChars = chunks.length * avgPrefix;
    const newScanChars = fixture.length;

    console.info(
      `[bench] fixture=${fixture.length} chars (~${Math.round(fixture.length / 4)} tokens) feeds=${chunks.length} fragments=${fragments}+${fin.length} ` +
        `feedMs=${feedMs.toFixed(1)} finalizeMs=${finalizeMs.toFixed(1)} ` +
        `scanChars old=${oldScanChars.toExponential(2)} new=${newScanChars.toExponential(2)}`,
    );

    expect(fragments + fin.filter((f) => f.type === 'dimension').length).toBeGreaterThanOrEqual(DIMENSIONS);
    // Wall-time guard against regression back to O(n^2): a single rescan-free
    // pass over ~100 KB is milliseconds; the O(n^2) path is seconds. 5s bound
    // is generous for the fixed path but catastrophically tight for the old.
    expect(feedMs).toBeLessThan(5000);
  }, 30000);
});
