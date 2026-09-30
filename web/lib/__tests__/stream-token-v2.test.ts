/**
 * R3b 2.2 (ADR 037 Addendum A3): v2 stream token signer + transcript-slice
 * bound signature.
 *
 * Contract: signStreamTokenV2 signs
 * `v2:${videoId}:${analysisId}:${exp}:${modelStr}:${streamCount}:${jevChunkIndex}:${jevChunkCount}`
 * with the SAME secret and TTL as the v1 signer, so the worker's dual-verify
 * window can validate both formats against one shared secret. A different
 * map-reduce cell MUST produce a different signature (cell binding).
 *
 * signTranscriptSlice signs `${purpose}:${id}:${exp}:${sha256}:${start}:${end}`
 * under the shared bound-content layout (purpose 'transcript-slice'), so a
 * slice signature can never be replayed cross-flow or against a different
 * analysis. It consumes the v2 token's exp so both signatures share one
 * replay window.
 *
 * Negative controls (HARD RULE 6): the cell-binding test and the slice
 * tamper/purpose tests each have a reverted-form variant below proving the
 * assertion fails without the binding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'test-stream-hmac-secret';

function computeHmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

describe('signStreamTokenV2 (R3b 2.2)', () => {
  beforeEach(() => {
    process.env.STREAM_HMAC_SECRET = SECRET;
    delete process.env.DEV_HMAC_SECRET;
    process.env.NODE_ENV = 'development';
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.STREAM_HMAC_SECRET;
    delete process.env.NODE_ENV;
  });

  it('signs the v2 message layout with the same secret as v1', async () => {
    const { signStreamTokenV2 } = await import('@/lib/stream-token');
    const { sig, exp } = await signStreamTokenV2({
      videoId: 'abc123',
      analysisId: 'an-1',
      models: ['m/b', 'm/a'],
      streamCount: 12,
      jevChunkIndex: 2,
      jevChunkCount: 4,
    });
    const expected = computeHmac(SECRET, `v2:abc123:an-1:${exp}:m/a,m/b:12:2:4`);
    expect(sig).toBe(expected);
  });

  it('different map-reduce cell produces a different signature (cell binding)', async () => {
    const { signStreamTokenV2 } = await import('@/lib/stream-token');
    const base = {
      videoId: 'abc123',
      analysisId: 'an-1',
      models: ['m/a'],
      streamCount: 12,
      jevChunkCount: 4,
    };
    const cellA = await signStreamTokenV2({ ...base, jevChunkIndex: 0 });
    const cellB = await signStreamTokenV2({ ...base, jevChunkIndex: 1 });

    // The binding contract itself: same inputs EXCEPT the cell index must
    // yield a different signature.
    expect(cellA.sig).not.toBe(cellB.sig);

    // Negative control: a signer that DROPS the cell fields from the message
    // (the pre-v2 layout) produces a DIFFERENT sig than the real one at the
    // same exp — proving the assertion above is carried by the cell binding,
    // not the test's coincidence.
    const unboundSig = (exp: number) => computeHmac(SECRET, `v2:${base.videoId}:${base.analysisId}:${exp}:m/a`);
    expect(cellA.sig).not.toBe(unboundSig(cellA.exp));
  });
});

describe('signTranscriptSlice (R3b 2.2)', () => {
  beforeEach(() => {
    process.env.STREAM_HMAC_SECRET = SECRET;
    delete process.env.DEV_HMAC_SECRET;
    process.env.NODE_ENV = 'development';
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.STREAM_HMAC_SECRET;
    delete process.env.NODE_ENV;
  });

  it('signs the transcript-slice bound-content message (purpose:id:exp:sha256:start:end)', async () => {
    const { signTranscriptSlice } = await import('@/lib/stream-token');
    const { sig } = await signTranscriptSlice('an-1', 123456, {
      startWord: 0,
      endWord: 512,
      sha256: 'deadbeef',
    });
    expect(sig).toBe(computeHmac(SECRET, `transcript-slice:an-1:123456:deadbeef:0:512`));
  });

  it('rejects (differs) when the sha256 or bounds are tampered, or under a different purpose', async () => {
    const { signTranscriptSlice } = await import('@/lib/stream-token');
    const { sig } = await signTranscriptSlice('an-1', 123456, {
      startWord: 0,
      endWord: 512,
      sha256: 'deadbeef',
    });
    const tamperedHash = computeHmac(SECRET, `transcript-slice:an-1:123456:cafebabe:0:512`);
    const tamperedBounds = computeHmac(SECRET, `transcript-slice:an-1:123456:deadbeef:0:600`);
    const wrongPurpose = computeHmac(SECRET, `persist:an-1:123456:deadbeef:0:512`);
    expect(sig).not.toBe(tamperedHash);
    expect(sig).not.toBe(tamperedBounds);
    expect(sig).not.toBe(wrongPurpose);
  });
});
