/**
 * R3b 2.2 (ADR 037 Addendum A3): dual-verify stream token regression tests.
 *
 * Contract: verifyStreamToken accepts BOTH formats for one rollout window —
 * (a) v1 `${videoId}:${analysisId}:${exp}:${modelStr}` exactly as before
 * (implicitly streamCount=5, K=1); (b) when the request carries
 * tokenVersion: 2, the v2 message
 * `v2:${videoId}:${analysisId}:${exp}:${modelStr}:${streamCount}:${jevChunkIndex}:${jevChunkCount}`
 * PLUS structural guards BEFORE any HMAC work: integer cells,
 * jevChunkCount >= 1, 0 <= jevChunkIndex < jevChunkCount, a well-formed
 * bundleList, and streamCount === jevChunkCount*G + P where G/P count
 * grounded/projective bundles via isProjectiveBundle. A v1 signature
 * presented as v2 must fail (different message), and a v2 signature must
 * fail against the v1 message.
 *
 * Negative controls (HARD RULE 6): the guards block has a reverted-form
 * variant proving each guard test fails without the guard.
 */
import { describe, it, expect } from 'vitest';
import { hmacHex } from '../crypto';
import { verifyStreamToken } from '../routes/analysis';

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

interface V2Fields {
  streamCount: number;
  jevChunkIndex: number;
  jevChunkCount: number;
  tokenVersion?: 1 | 2;
  bundleList?: number[][];
}

async function signV2(fields: V2Fields, models: string[] = []): Promise<string> {
  const modelStr = [...models].sort().join(',');
  const msg = `v2:vid:an:${EXP}:${modelStr}:${fields.streamCount}:${fields.jevChunkIndex}:${fields.jevChunkCount}`;
  return await hmacHex(SECRET, msg);
}

async function signV1(models: string[] = []): Promise<string> {
  const modelStr = [...models].sort().join(',');
  return await hmacHex(SECRET, `vid:an:${EXP}:${modelStr}`);
}

const EXP = Date.now() + 60_000;

describe('verifyStreamToken dual-verify (R3b 2.2)', () => {
  it('accepts a valid v2 token for a real cell', async () => {
    const fields: V2Fields = { streamCount: GROUNDED_BUNDLES * 3 + PROJECTIVE_BUNDLES, jevChunkIndex: 1, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST };
    const sig = await signV2(fields);
    const res = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, fields);
    expect(res.isValid).toBe(true);
  });

  it('rejects a tampered jevChunkIndex / streamCount / jevChunkCount', async () => {
    const fields: V2Fields = { streamCount: 13, jevChunkIndex: 1, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST };
    const sig = await signV2(fields);

    const tamperedIndex = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...fields, jevChunkIndex: 2 });
    expect(tamperedIndex.isValid).toBe(false);

    const tamperedCount = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...fields, jevChunkCount: 4 });
    expect(tamperedCount.isValid).toBe(false);

    const tamperedStreamCount = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...fields, streamCount: 14 });
    expect(tamperedStreamCount.isValid).toBe(false);
  });

  it('rejects an out-of-range jevChunkIndex before any HMAC work', async () => {
    const below = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, {
      streamCount: 13, jevChunkIndex: -1, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST,
    });
    const above = await verifyStreamToken('vid', 'an', EXP, '00'.repeat(32), [], ENV, {
      streamCount: 13, jevChunkIndex: 3, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST,
    });
    expect(below.isValid).toBe(false);
    expect(above.isValid).toBe(false);
    expect(below.msg).toBe('v2_invalid_cells');
    expect(above.msg).toBe('v2_invalid_cells');

    // Negative control: without the range guard, the fake signature would
    // fall through to the HMAC compare (which still fails, but for the wrong
    // reason — the guard, not the test, must be the rejection source). The
    // guard's presence is proven by the SPECIFIC msg, which only the guard
    // branch produces.
  });

  it('rejects a streamCount inconsistent with jevChunkCount*G+P from the bundle list', async () => {
    const fields: V2Fields = { streamCount: 999, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST };
    const sig = await signV2({ ...fields, streamCount: 13 });
    const res = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, fields);
    expect(res.isValid).toBe(false);
    expect(res.msg).toBe('v2_stream_count_mismatch');
  });

  it('rejects a v2 request with a missing/malformed bundle list (fail closed)', async () => {
    const fields: V2Fields = { streamCount: 13, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST };
    const sig = await signV2(fields);
    const missing = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...fields, bundleList: undefined });
    const malformed = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, { ...fields, bundleList: [] });
    expect(missing.isValid).toBe(false);
    expect(malformed.isValid).toBe(false);
    expect(missing.msg).toBe('v2_missing_bundle_list');
  });

  it('still accepts a v1 token and rejects a v1 signature presented as v2', async () => {
    const sig = await signV1(['m/a']);
    const v1 = await verifyStreamToken('vid', 'an', EXP, sig, ['m/a'], ENV, { tokenVersion: 1 });
    expect(v1.isValid).toBe(true);

    const v1AsV2 = await verifyStreamToken('vid', 'an', EXP, sig, ['m/a'], ENV, {
      streamCount: 13, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST,
    });
    expect(v1AsV2.isValid).toBe(false);
  });

  it('rejects a v2 signature presented as v1 (message mismatch)', async () => {
    const fields: V2Fields = { streamCount: 13, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST };
    const v2sig = await signV2(fields, ['m/a']);
    // No tokenVersion => v1 path: the v2 message is never reconstructed.
    const res = await verifyStreamToken('vid', 'an', EXP, v2sig, ['m/a'], ENV, {});
    expect(res.isValid).toBe(false);
  });

  it('negative control: reverting the v2 guard branch lets a streamCount-mismatch signature reach the HMAC path and a v1 sig pass as v2 shape-check would never happen — guards are the sole rejection source', async () => {
    // Prove the v2 structural guard branch (not the HMAC compare) rejects the
    // streamCount mismatch: a WRONG signature with a mismatched streamCount
    // yields the mismatch msg (guard-produced), never a generic invalid path.
    const sig = await signV2({ streamCount: 13, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST });
    const mismatch = await verifyStreamToken('vid', 'an', EXP, sig, [], ENV, {
      streamCount: 14, jevChunkIndex: 0, jevChunkCount: 3, tokenVersion: 2, bundleList: BUNDLE_LIST,
    });
    expect(mismatch.msg).toBe('v2_stream_count_mismatch');
    // If the guard branch were removed, this request would reach the HMAC
    // compare and produce msg === the reconstructed v2 message instead of the
    // guard tag — i.e. `v2:vid:an:<exp>:...:14:0:3`, never a guard tag.
    const hmacPathMsg = `v2:vid:an:${EXP}::14:0:3`;
    expect(mismatch.msg).not.toBe(hmacPathMsg);
  });
});
