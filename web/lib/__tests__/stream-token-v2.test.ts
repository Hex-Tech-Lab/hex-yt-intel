/**
 * R3b 2.3.5a (ADR 037 Addendum A): v2 stream token signer — one canonical
 * message per map-reduce cell that ALSO binds the bundle partition
 * (partitionDigest = sha256(canonicalJson(bundleList)), array order
 * meaningful) and the transcript slice (sliceSha256/startWord/endWord).
 *
 * Contract: signStreamTokenV2 signs
 * `v2:{videoId}:{analysisId}:{exp}:{models}:{streamCount}:{jevChunkIndex}:{jevChunkCount}:{chunkIndex}:{partitionDigest}:{sliceSha256}:{startWord}:{endWord}`
 * with the SAME secret and TTL as the v1 signer. Any one-field change in
 * bundleList / chunkIndex / sliceSha256 / startWord / endWord MUST change
 * the signature.
 *
 * signTranscriptSlice is RETIRED (folded into the token) — an import guard
 * below proves it no longer exists.
 *
 * Negative controls (HARD RULE 6): the partition/slice binding tests carry
 * reverted-form variants (messages built WITHOUT the bound fields) proving
 * the assertions are carried by the binding, not coincidence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { canonicalJson } from '@/lib/utils/canonical-json';

const SECRET = 'test-stream-hmac-secret';

function computeHmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

const BUNDLE_LIST: number[][] = [
  [1, 2, 3],
  [4, 5],
  [6, 7],
  [8, 10],
  [9, 11],
];

async function partitionDigestOf(list: number[][]): Promise<string> {
  const { sha256Hex } = await import('@/lib/stream-token');
  return sha256Hex(canonicalJson(list));
}

describe('signStreamTokenV2 (R3b 2.3.5a)', () => {
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

  it('signs the exact canonical v2 message template for a fixed input', async () => {
    const { signStreamTokenV2 } = await import('@/lib/stream-token');
    const { sig, exp } = await signStreamTokenV2({
      videoId: 'abc123',
      analysisId: 'an-1',
      models: ['m/b', 'm/a'],
      streamCount: 12,
      jevChunkIndex: 2,
      jevChunkCount: 4,
      chunkIndex: 5,
      bundleList: BUNDLE_LIST,
      slice: { sha256: 'a'.repeat(64), startWord: 0, endWord: 512 },
    });
    const digest = await partitionDigestOf(BUNDLE_LIST);
    const expected = computeHmac(
      SECRET,
      `v2:abc123:an-1:${exp}:m/a,m/b:12:2:4:5:${digest}:${'a'.repeat(64)}:0:512`,
    );
    expect(sig).toBe(expected);
  });

  it('changing ANY one bound field changes the signature', async () => {
    const { signStreamTokenV2 } = await import('@/lib/stream-token');
    const base = {
      videoId: 'abc123',
      analysisId: 'an-1',
      models: ['m/a'],
      streamCount: 12,
      jevChunkIndex: 0,
      jevChunkCount: 3,
      chunkIndex: 5,
      bundleList: BUNDLE_LIST,
      slice: { sha256: 'b'.repeat(64), startWord: 0, endWord: 512 },
    };
    const baseSig = (await signStreamTokenV2(base)).sig;
    expect((await signStreamTokenV2({ ...base, chunkIndex: 6 })).sig).not.toBe(baseSig);
    expect((await signStreamTokenV2({ ...base, bundleList: [...BUNDLE_LIST.slice(0, 4), [9, 11, 12]] })).sig).not.toBe(baseSig);
    expect((await signStreamTokenV2({ ...base, slice: { ...base.slice, sha256: 'c'.repeat(64) } })).sig).not.toBe(baseSig);
    expect((await signStreamTokenV2({ ...base, slice: { ...base.slice, startWord: 1 } })).sig).not.toBe(baseSig);
    expect((await signStreamTokenV2({ ...base, slice: { ...base.slice, endWord: 600 } })).sig).not.toBe(baseSig);
  });

  it('bundleList with the same content in a different order gives a DIFFERENT digest (order is meaningful)', async () => {
    const reordered = [BUNDLE_LIST[1], ...BUNDLE_LIST.slice(0, 1), ...BUNDLE_LIST.slice(2)] as number[][];
    expect([...reordered].sort()).toEqual([...BUNDLE_LIST].sort()); // same multiset
    expect(reordered.join('|')).not.toBe(BUNDLE_LIST.join('|'));
    const d1 = await partitionDigestOf(BUNDLE_LIST);
    const d2 = await partitionDigestOf(reordered);
    expect(d1).not.toBe(d2);
    // And the digest covers canonicalJson bytes exactly.
    expect(d1).toBe(await sha256Plain(canonicalJson(BUNDLE_LIST)));
  });

  it('negative control: a signer that drops partitionDigest/slice from the message produces a DIFFERENT signature (binding carries the assertion)', async () => {
    const { signStreamTokenV2 } = await import('@/lib/stream-token');
    const params = {
      videoId: 'abc123',
      analysisId: 'an-1',
      models: ['m/a'],
      streamCount: 12,
      jevChunkIndex: 0,
      jevChunkCount: 3,
      chunkIndex: 5,
      bundleList: BUNDLE_LIST,
      slice: { sha256: 'b'.repeat(64), startWord: 0, endWord: 512 },
    };
    const real = (await signStreamTokenV2(params)).sig;
    const { exp } = await signStreamTokenV2(params);
    // Reverted form: the pre-2.3.5a v2 layout (no partition, no slice fields).
    const unboundAtExp = computeHmac(SECRET, `v2:abc123:an-1:${exp}:m/a:12:0:3`);
    expect(real).not.toBe(unboundAtExp);
  });

  it('signTranscriptSlice is retired (no longer exported)', async () => {
    const mod = (await import('@/lib/stream-token')) as Record<string, unknown>;
    expect(mod.signTranscriptSlice).toBeUndefined();
  });
});

async function sha256Plain(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
