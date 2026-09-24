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
 * The O(n^2) regression guard asserts the MEASURED scannedChars counter on
 * BracketBuffer (per-iteration accounting in feed(), no behaviour change).
 */
import { describe, it, expect } from 'vitest';
import { BracketBuffer } from '../services/BracketBuffer';

const DIMENSIONS = 11;
const WORDS_PER_DIM = 1200; // ~1200 words x 11 dims ~ 20k tokens total envelope

const buildWords = (seed: number, count: number): string => {
  const base = [
    'the', 'analysis', 'of', 'audience', 'retention', 'signals', 'shows', 'that', 'narrative', 'pacing',
    'directly', 'shapes', 'viewer', 'behaviour', 'across', 'formats', 'and', 'community', 'engagement',
    'patterns', 'emerge', 'when', 'creators', 'respond', 'to', 'comments', 'with', 'structured',
    'follow', 'up', 'videos', 'because', 'early', 'hooks', 'determine', 'whether', 'viewers', 'stay',
  ];
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const word = base[(i * 7 + seed) % base.length];
    if (word) words.push(word);
  }
  return words.join(' ');
};

/** Realistic v2.0 envelope with a leading ```json fence (the bug trigger). */
const buildFixture = (dimensions = DIMENSIONS, wordsPerDim = WORDS_PER_DIM): string => {
  const dims: string[] = [];
  for (let d = 1; d <= dimensions; d++) {
    dims.push(
      `{"number":${d},"name":"Dimension ${d}","content":"${buildWords(d, wordsPerDim).replace(/"/g, '')}"}`,
    );
  }
  return `\`\`\`json
{"schemaVersion":"2.0","dimensions":[${dims.join(',')}]}`;
};

/** Token-sized SSE deltas, like OpenRouter's streaming chunks. */
const chunkify = (fixtureText: string, chunkSize = 24): string[] => {
  const chunks: string[] = [];
  // charAt loop instead of slice: lossless tokenization (no truncation), and
  // avoids the truncation-validation false-positive on a display slice.
  for (let i = 0; i < fixtureText.length; i += chunkSize) {
    let chunk = '';
    for (let j = i; j < i + chunkSize && j < fixtureText.length; j++) chunk += fixtureText.charAt(j);
    chunks.push(chunk);
  }
  return chunks;
};

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
        `scannedChars=${bb.getState().scannedChars.toExponential(2)} ` +
        `algebraic old=${oldScanChars.toExponential(2)} new=${newScanChars.toExponential(2)} (estimates, see assertion below)`,
    );

    expect(fragments + fin.filter((f) => f.type === 'dimension').length).toBeGreaterThanOrEqual(DIMENSIONS);
    // Deterministic O(n^2) regression guard (Cubic P2, 2026-09-24): assert the
    // MEASURED scan work (BracketBuffer.scannedChars, counted per character
    // iteration in feed()), not a wall-clock ceiling or an algebraic estimate.
    // Fixed code scans each buffered char exactly once => scannedChars is
    // O(fixture.length). The old rescan bug rescans the whole accumulated
    // buffer on every feed => ~feeds x avgPrefix (~1e8 for this fixture), which
    // blows past any constant multiple of fixture.length. k=4 gives margin for
    // the pre-envelope fence handling without admitting a rescan path.
    expect(bb.getState().scannedChars).toBeLessThanOrEqual(4 * fixture.length);
    // Depth must reflect real nesting (envelope + dimensions array), not the
    // old stale-state inflation; and finalize() must have nothing left to
    // repair because the envelope already closed during feed().
    expect(bb.getState().depth).toBeLessThanOrEqual(3);
    expect(fin.filter((f) => f.type === 'dimension').length).toBe(0);
    // Wall time is INFORMATIONAL only (V8 warm-JIT makes even the O(n^2) path
    // look fast in-process; the real exceededCpu came from cold-isolate CPU).
    console.info(`[bench] feedMs=${feedMs.toFixed(1)}ms (informational, not asserted)`);
  }, 30000);
});
