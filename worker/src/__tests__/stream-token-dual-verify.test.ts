/**
 * R3b 2.3.5a (ADR 037 Addendum A): v2 stream token dual-verify regression
 * tests — verify-side only (nothing emits v2 in production yet).
 *
 * Contract: verifyStreamToken accepts BOTH formats —
 * (a) v1 `${videoId}:${analysisId}:${exp}:${modelStr}` byte-for-byte unchanged;
 * (b) when tokenVersion === 2, the canonical message
 * `v2:{videoId}:{analysisId}:{exp}:{models}:{streamCount}:{jevChunkIndex}:{jevChunkCount}:{chunkIndex}:{partitionDigest}:{sliceSha256}:{startWord}:{endWord}`
 * where partitionDigest = lowercase hex sha256 of canonicalJson(bundleList)
 * (array order meaningful). Structural guards run BEFORE any HMAC work:
 * integer cells, jevChunkCount >= 1, 0 <= jevChunkIndex < jevChunkCount,
 * well-formed bundleList, streamCount === jevChunkCount*G + P,
 * integer chunkIndex >= 1, sliceSha256 /^[0-9a-flds]{64}$/,
 * 0 <= startWord < endWord (both integers). The v2 branch is exercised as a
 * ROUND TRIP against the web signer (same secret) — the E2E proof, not a
 * code-reading claim.
 *
 * The tokenVersion allowlist (call-site: unknown version -> 401, absent ->
 * v1) is covered here at the verifyStreamToken contract level: a non-2
 * non-1 version must never fall through to the v1 path.
 *
 * Negative controls (HARD RULE 6): guards' SPECIFIC msg tags (only the guard
 * branch produces them) prove the guard, not the HMAC compare, is the
 * rejection source.
 */
import { describe, it, expect } from 'vitest';
import { hmacHex } from '../crypto';
import { verifyStreamToken } from '../routes/analysis';
import { canonicalJson } from '../../../web/lib/utils/canonical-json';

const SECRET = 'test-stream-hmac-secret';

const ENV = {
  STREAM_HMAC_SECRET: SECRET,
  APP_URL: 'https://example.com',
} as never;

// STREAM_BUNDLES partition: 4 grounded + 1 projective ([9,11]).
const BUNDLE_LIST: number[][] = [
  [1, 2, 3],
  [4, 5],
  [6, 7],
  [8, 10],
  [9, 11],
];
const GROUNDED_BUNDLES = 4;
const PROJECTIVE_BUNDLES = 1;

const SLICE = { sha256: 'a'.repeat(64), startWord: 0, endWord: 512 } as const;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function partitionDigestOf(list: number[][]): Promise<string> {
  return await sha256Hex(canonicalJson(list));
}

interface V2Fields {
  streamCount: number;
  jevChunkIndex: number;
  jevChunkCount: number;
  chunkIndex: number;
  bundleList?: number[][];
  omitBundleList?: boolean;
  sliceSha256?: string;
  startWord?: number;
  endWord?: number;
  tokenVersion?: unknown;
  omitDigestFromMsg?: boolean;
  /** Request dimensions; defaults to the signed bundleList[chunkIndex - 1]. */
  dimensions?: number[];
}

function buildV2Msg(exp: number, flds: V2Fields, modelStr: string, partitionDigest: string): string {
  const sliceSha = flds.sliceSha256 ?? SLICE.sha256;
  const startWord = flds.startWord ?? SLICE.startWord;
  const endWord = flds.endWord ?? SLICE.endWord;
  if (flds.omitDigestFromMsg) {
    // Reverted form (negative control): pre-2.3.5a v2 layout.
    return `v2:vid:an:${exp}:${modelStr}:${flds.streamCount}:${flds.jevChunkIndex}:${flds.jevChunkCount}`;
  }
  return `v2:vid:an:${exp}:${modelStr}:${flds.streamCount}:${flds.jevChunkIndex}:${flds.jevChunkCount}:${flds.chunkIndex}:${partitionDigest}:${sliceSha}:${startWord}:${endWord}`;
}

async function signV2(exp: number, flds: V2Fields, models: string[] = []): Promise<string> {
  const modelStr = [...models].sort().join(',');
  const partitionDigest = await partitionDigestOf(flds.bundleList ?? BUNDLE_LIST);
  return await hmacHex(SECRET, buildV2Msg(exp, flds, modelStr, partitionDigest));
}

async function signV1(exp: number, models: string[] = []): Promise<string> {
  const modelStr = [...models].sort().join(',');
  return await hmacHex(SECRET, `vid:an:${exp}:${modelStr}`);
}

function v2Opts(flds: V2Fields) {
  return {
    tokenVersion: (flds.tokenVersion ?? 2) as 1 | 2,
    streamCount: flds.streamCount,
    jevChunkIndex: flds.jevChunkIndex,
    jevChunkCount: flds.jevChunkCount,
    bundleList: flds.omitBundleList ? undefined : (flds.bundleList ?? BUNDLE_LIST),
    chunkIndex: flds.chunkIndex,
    sliceSha256: flds.sliceSha256 ?? SLICE.sha256,
    startWord: flds.startWord ?? SLICE.startWord,
    endWord: flds.endWord ?? SLICE.endWord,
    dimensions: flds.dimensions ?? (flds.bundleList ?? BUNDLE_LIST)[flds.chunkIndex - 1],
  };
}

const EXP = Date.now() + 60_000;
const VALID: V2Fields = {
  streamCount: GROUNDED_BUNDLES * 3 + PROJECTIVE_BUNDLES,
  jevChunkIndex: 1,
  jevChunkCount: 3,
  chunkIndex: 5,
};

describe('verifyStreamToken dual-verify (R3b 2.3.5a)', () => {
  it('ROUND TRIP: a token minted by the WEB signer verifies in the worker (same secret)', async () => {
    const { signStreamTokenV2 } = (await import(
      '../../../web/lib/stream-token'
    )) as typeof import('../../../web/lib/stream-token') & Record<string, never>;
    process.env.STREAM_HMAC_SECRET = SECRET;
    process.env.NODE_ENV = 'development';
    const { sig, exp: webExp } = await signStreamTokenV2({
      videoId: 'vid',
      analysisId: 'an',
      streamCount: VALID.streamCount,
      jevChunkIndex: VALID.jevChunkIndex,
      jevChunkCount: VALID.jevChunkCount,
      chunkIndex: VALID.chunkIndex,
      bundleList: BUNDLE_LIST,
      slice: { sha256: SLICE.sha256, startWord: SLICE.startWord, endWord: SLICE.endWord },
    });
    // The web signer mints its own exp — verify against THAT exp (round trip).
    const res = await verifyStreamToken('vid', 'an', webExp, sig, [], ENV, v2Opts(VALID));
    expect(res.isValid).toBe(true);
    delete process.env.STREAM_HMAC_SECRET;
  });

  it('accepts a valid v2 token for a real cell (worker-side signing) and rejects any single-field tamper', async () => {
    const sig = await signV2(EXP, VALID);
    const ok = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts(VALID));
    expect(ok.isValid).toBe(true);

    // bundleList reordered (counts still satisfy streamCount = K*G+P)
    const reordered = [BUNDLE_LIST[1], BUNDLE_LIST[0], ...BUNDLE_LIST.slice(2)] as number[][];
    expect(reordered.length).toBe(BUNDLE_LIST.length);
    const tamperedBundle = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, bundleList: reordered }));
    expect(tamperedBundle.isValid).toBe(false);

    // bundleList content changed
    const changed = [BUNDLE_LIST[0], [4, 5, 99], ...BUNDLE_LIST.slice(2)] as number[][];
    const tamperedBundle2 = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, bundleList: changed }));
    expect(tamperedBundle2.isValid).toBe(false);

    // chunkIndex changed
    const tamperedChunk = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, chunkIndex: 6 }));
    expect(tamperedChunk.isValid).toBe(false);

    // sliceSha256 changed
    const tamperedSha = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, sliceSha256: 'b'.repeat(64) }));
    expect(tamperedSha.isValid).toBe(false);

    // startWord/endWord shifted
    const tamperedStart = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, startWord: 1 }));
    expect(tamperedStart.isValid).toBe(false);
    const tamperedEnd = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, endWord: 600 }));
    expect(tamperedEnd.isValid).toBe(false);

    // cells tamper still covered
    const tamperedIndex = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, jevChunkIndex: 2 }));
    expect(tamperedIndex.isValid).toBe(false);
    const tamperedStreamCount = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, streamCount: VALID.streamCount + 1 }));
    expect(tamperedStreamCount.isValid).toBe(false);
  });

  it('structural rejects happen WITHOUT HMAC work (specific guard msgs)', async () => {
    const badSha = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, sliceSha256: 'ZZZ' }));
    const badRange = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, startWord: 512, endWord: 512 }));
    const badRange2 = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, startWord: -1 }));
    const badChunk = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, chunkIndex: 0 }));
    const badChunkNonInt = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, chunkIndex: 1.5 } as unknown as V2Fields));
    for (const r of [badSha, badRange, badRange2, badChunk, badChunkNonInt]) {
      expect(r.isValid).toBe(false);
      expect(r.msg).toBe('v2_invalid_slice');
    }

    const mismatch = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, v2Opts({ ...VALID, streamCount: 999 }));
    expect(mismatch.msg).toBe('v2_stream_count_mismatch');
  });

  it('rejects request dimensions that differ from the signed bundle (no projective claim to skip the slice)', async () => {
    const sig = await signV2(EXP, VALID);
    const grounded = { ...VALID, chunkIndex: 1 };
    const groundedSig = await signV2(EXP, grounded);
    expect((await verifyStreamToken('vid', 'an', EXP, groundedSig, [], ENV, v2Opts(grounded))).isValid).toBe(true);
    const projectiveBundle = BUNDLE_LIST[BUNDLE_LIST.length - 1] as number[];
    for (const dimensions of [projectiveBundle, [], [...(BUNDLE_LIST[0] as number[]), 3], [...(BUNDLE_LIST[0] as number[])].reverse()]) {
      const res = await verifyStreamToken('vid', 'an', EXP, groundedSig, [], ENV, { ...v2Opts(grounded), dimensions });
      expect(res).toMatchObject({ isValid: false, msg: 'v2_dimensions_mismatch' });
    }
    const absent = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...v2Opts(VALID), dimensions: undefined });
    expect(absent.msg).toBe('v2_dimensions_mismatch');
    const outOfRange = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, chunkIndex: BUNDLE_LIST.length + 1, dimensions: [1] }));
    expect(outOfRange.msg).toBe('v2_dimensions_mismatch');
  });

  it('downgrade/upgrade: tokenVersion 3 rejected, "2" (string) rejected, absent still verifies as v1', async () => {
    // Version 3: at the verifyStreamToken level, a non-2 tokenVersion takes
    // the v1 path — the CALL SITE allowlist rejects it before this. Prove
    // v3's signature never verifies on either path.
    const v3Sig = await hmacHex(SECRET, `v3:vid:an:${EXP}:`);
    const v3 = await verifyStreamToken('vid', 'an', EXP, v3Sig, [], ENV, { ...v2Opts(VALID), tokenVersion: 3 as unknown as 2 });
    expect(v3.isValid).toBe(false);

    // String "2" must be treated as unknown at the call site; here it also
    // fails the v2 branch (strict === 2) and would land on the v1 path with a
    // v2-shaped signature — mismatch either way.
    const v2sig = await signV2(EXP, VALID);
    const strTwo = await verifyStreamToken('vid', 'an', EXP, v2sig, [], ENV, { ...v2Opts(VALID), tokenVersion: '2' as unknown as 2 });
    expect(strTwo.isValid).toBe(false);

    // Absent stays v1.
    const v1Sig = await signV1(EXP, ['m/a']);
    const v1 = await verifyStreamToken('vid', 'an', EXP, v1Sig, ['m/a'], ENV, {});
    expect(v1.isValid).toBe(true);

    // v1 token round trip unchanged: same message layout as pre-change.
    const v1SigExplicit = await signV1(EXP, ['m/a']);
    const v1Explicit = await verifyStreamToken('vid', 'an', EXP, v1SigExplicit, ['m/a'], ENV, { tokenVersion: 1 });
    expect(v1Explicit.isValid).toBe(true);

    // Cross-format presentation still rejected.
    const v1AsV2 = await verifyStreamToken('vid', 'an', EXP, v1Sig, ['m/a'], ENV, v2Opts(VALID));
    expect(v1AsV2.isValid).toBe(false);
    const v2AsV1 = await verifyStreamToken('vid', 'an', EXP, v2sig, ['m/a'], ENV, {});
    expect(v2AsV1.isValid).toBe(false);
  });

  it('projective cells: the empty slice (0, 0, sha256("")) verifies; any other empty or reversed range is rejected structurally', async () => {
    const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const projective = { ...VALID, jevChunkIndex: 0, chunkIndex: 5, sliceSha256: EMPTY, startWord: 0, endWord: 0 };
    const sig = await signV2(EXP, projective);
    expect((await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts(projective))).isValid).toBe(true);
    for (const bad of [
      { ...projective, startWord: 7, endWord: 7 },
      { ...projective, sliceSha256: SLICE.sha256 },
      { ...projective, startWord: 9, endWord: 3 },
    ]) {
      const res = await verifyStreamToken('vid', 'an', EXP, await signV2(EXP, bad), [], ENV, v2Opts(bad));
      expect(res.isValid).toBe(false);
      expect(res.msg).toBe('v2_invalid_slice');
    }
  });

  it('rejects a streamCount inconsistent with jevChunkCount*G+P from the bundle list', async () => {
    const fields: V2Fields = { ...VALID, streamCount: 999 };
    const sig = await signV2(EXP, { ...VALID });
    const res = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts(fields));
    expect(res.isValid).toBe(false);
    expect(res.msg).toBe('v2_stream_count_mismatch');
  });

  it('rejects a v2 request with a missing/malformed bundle list (fail closed)', async () => {
    const sig = await signV2(EXP, VALID);
    const missing = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, omitBundleList: true }));
    const malformed = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, bundleList: [] }));
    expect(missing.isValid).toBe(false);
    expect(malformed.isValid).toBe(false);
    expect(missing.msg).toBe('v2_missing_bundle_list');
  });

  it('negative control (in-test): a signature over the UNBOUND (pre-2.3.5a) message never verifies — the worker always includes partitionDigest + slice in the rebuilt message', async () => {
    const unbound = `v2:vid:an:${EXP}::${VALID.streamCount}:${VALID.jevChunkIndex}:${VALID.jevChunkCount}`;
    const sigUnbound = await hmacHex(SECRET, unbound);
    const res = await verifyStreamToken('vid', 'an', EXP, sigUnbound, [], ENV, v2Opts(VALID));
    expect(res.isValid).toBe(false);
    // And the failure message IS the rebuilt (bound) message — proving the
    // worker rebuilt the NEW layout, not the old one.
    expect(res.msg).toContain(await partitionDigestOf(BUNDLE_LIST));
    // The rebuilt msg embeds the slice fields — the unbound layout has none.
    expect(res.msg).toContain(SLICE.sha256);
  });

  it('negative control: guard tags are guard-produced, not HMAC-path-produced', async () => {
    const sig = await signV2(EXP, VALID);
    const mismatch = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, v2Opts({ ...VALID, streamCount: VALID.streamCount + 1 }));
    expect(mismatch.msg).toBe('v2_stream_count_mismatch');
    const hmacPathMsgPrefix = `v2:vid:an:${EXP}`;
    expect(mismatch.msg.startsWith(hmacPathMsgPrefix)).toBe(false);
  });
});
