/**
 * ADR 021 Phase 1 -- Cubic P1 finding verification.
 *
 * The Phase 1 fix (worker/src/routes/analysis.ts's capturedDimensions +
 * PersistService.mergeDimensions) rests on a specific claim about
 * BracketBuffer: that `onFragment` fires per-dimension, "the moment its
 * closing brace arrives, independent of every other dimension's fate."
 *
 * That claim was NEVER verified against BracketBuffer's actual source before
 * this PR shipped. Reading BracketBuffer.ts directly shows the real
 * mechanism is different:
 *
 * - `feed()` only emits a fragment when bracket depth returns to 0, i.e.
 *   when a TOP-LEVEL object closes. The real LLM output is a single
 *   envelope object `{schemaVersion:"2.0", dimensions:[...]}` (confirmed via
 *   worker/src/services/PromptBuilder.ts:107 -- "Start the JSON envelope
 *   structure with schemaVersion 2.0"). Individual dimension objects live
 *   INSIDE the `dimensions` array, at depth 2, not depth 0 -- so `feed()`
 *   does NOT emit per-dimension fragments while the envelope is still open.
 *   It emits nothing until the whole envelope closes, which (for a
 *   successful, non-aborted generation) is effectively the same moment
 *   finalText itself becomes fully parseable.
 * - The only mechanism that can yield fragments from a TRUNCATED stream
 *   (the actual incident scenario: force-abort mid-generation) is
 *   `finalize()`, which runs once at stream end, best-effort REPAIRS the
 *   trailing unclosed buffer (naive bracket/quote closing), and then does a
 *   SINGLE `JSON.parse` + `tryParseDimension` pass over the WHOLE repaired
 *   buffer -- not an independent per-dimension check. This is the same
 *   all-or-nothing failure class PersistService's whole-text extraction
 *   path already has (a repair that doesn't produce valid JSON loses every
 *   dimension in the trailing buffer, not just the malformed one).
 *
 * So capturedDimensions in the abort scenario is populated by best-effort
 * post-hoc repair, not by "confirmed independently as it streams" as ADR 021
 * and analysis.ts's comments (both corrected in this pass) previously
 * claimed. This test proves the OBSERVED behavior directly against the real
 * source, not the originally assumed design.
 */
import { describe, it, expect } from 'vitest';
import { BracketBuffer } from '../services/BracketBuffer';

describe('BracketBuffer emission-boundary (ADR 021 Phase 1 verification)', () => {
  it('feed() emits ZERO dimension fragments while the outer envelope is still open, even after multiple complete dimensions have streamed by', () => {
    const bb = new BracketBuffer();

    // Stream the envelope open + two fully complete dimension objects, but
    // do NOT close the outer envelope yet -- this is the live-streaming
    // state during any in-progress (non-aborted, non-finalized) generation.
    const chunk =
      '{"schemaVersion":"2.0","dimensions":[' +
      '{"number":1,"name":"D1","content":"complete content one"},' +
      '{"number":2,"name":"D2","content":"complete content two"},';

    const fragments = bb.feed(chunk);

    // Per the ADR's original claim, this should have produced 2 'dimension'
    // fragments already (dims 1 and 2 are individually complete, valid JSON
    // objects). It does not -- feed() only fires at depth 0, and depth is
    // still 2 (envelope + dimensions array) at this point.
    expect(fragments.filter((f) => f.type === 'dimension')).toHaveLength(0);
  });

  it('feed() DOES emit both dimensions the instant the outer envelope closes -- confirming the trigger is envelope-closure, not per-dimension-closure', () => {
    const bb = new BracketBuffer();
    const full =
      '{"schemaVersion":"2.0","dimensions":[' +
      '{"number":1,"name":"D1","content":"complete content one"},' +
      '{"number":2,"name":"D2","content":"complete content two"}' +
      ']}';

    const fragments = bb.feed(full);
    const dims = fragments.filter((f) => f.type === 'dimension');
    expect(dims).toHaveLength(2);
    expect(dims.map((d) => d.dimension)).toEqual([1, 2]);
  });

  it('finalize() recovers dimensions from a truncated envelope via best-effort bracket/quote repair (the actual Phase 1 recovery path)', () => {
    const bb = new BracketBuffer();
    // Simulate a mid-generation abort: envelope open, dim 1 and 2 fully
    // streamed, dim 3's content string cut off mid-sentence -- no closing
    // quote/brace/bracket for dim 3, the array, or the envelope.
    const truncated =
      '{"schemaVersion":"2.0","dimensions":[' +
      '{"number":1,"name":"D1","content":"complete content one"},' +
      '{"number":2,"name":"D2","content":"complete content two"},' +
      '{"number":3,"name":"D3","content":"mid-generation abort, cut off here';

    bb.feed(truncated); // no depth-0 closure reached -- feed() alone yields nothing
    const finalFragments = bb.finalize();
    const dims = finalFragments.filter((f) => f.type === 'dimension');

    // This specific truncation pattern (cut mid-string, inside the last
    // array element) IS recoverable by repairUnclosedJson's naive
    // quote+bracket closing -- all 3 dimensions come back, with dim 3's
    // content garbled but the object still valid JSON.
    expect(dims.map((d) => d.dimension)).toEqual([1, 2, 3]);
  });

  it('finalize() recovers ZERO dimensions when truncation happens mid-KEY (no value to repair) -- proves recovery is best-effort, not guaranteed', () => {
    const bb = new BracketBuffer();
    // Truncated between two dimensions, mid-way through typing the NEXT
    // key name ("num" instead of "number") -- repairUnclosedJson can only
    // close open strings/brackets, it cannot invent a missing value for a
    // dangling key. This produces invalid JSON that JSON.parse rejects, so
    // the entire trailing buffer -- including dims 1 and 2, which WERE
    // individually complete and valid -- is lost. This is the exact
    // all-or-nothing failure mode Cubic's P1 finding warned about.
    const truncated =
      '{"schemaVersion":"2.0","dimensions":[' +
      '{"number":1,"name":"D1","content":"complete content one"},' +
      '{"number":2,"name":"D2","content":"complete content two"},' +
      '{"num';

    bb.feed(truncated);
    const finalFragments = bb.finalize();
    const dims = finalFragments.filter((f) => f.type === 'dimension');

    expect(dims).toHaveLength(0);
  });
});
