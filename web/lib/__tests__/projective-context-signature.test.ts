/**
 * R2b: the Vercel signer (web/lib/stream-token.ts#signProjectiveContext) and
 * the worker verifier (web/lib/config/projective-context.ts#verifyProjectiveContextSig,
 * called by worker/src/routes/analysis.ts) must agree byte-for-byte, and any
 * tampering (payload, analysis id, dimensions, expiry, secret) must fail.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { verifyProjectiveContextSig } from '../config/projective-context';

const SECRET = 'test-stream-hmac-secret';
beforeAll(() => {
  process.env.STREAM_HMAC_SECRET = SECRET;
});

const payload = { schemaVersion: '2.0', dimensions: [{ number: 1, content: 'grounded apex' }], explicitSpeakerResources: ['Book A'] };

async function signed() {
  const { signProjectiveContext } = await import('../stream-token');
  return signProjectiveContext('analysis-1', [11, 9], payload);
}

describe('projective context signature (web signer <-> worker verifier)', () => {
  it('verifies a genuine signature, independent of dimension order', async () => {
    const { sig, exp } = await signed();
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: payload, contextSig: sig, contextExp: exp })).resolves.toBe(true);
  });

  it('survives the JSON round trip the payload takes client -> worker', async () => {
    const { sig, exp } = await signed();
    const roundTripped = JSON.parse(JSON.stringify(payload));
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: roundTripped, contextSig: sig, contextExp: exp })).resolves.toBe(true);
  });

  it('rejects a browser-edited payload', async () => {
    const { sig, exp } = await signed();
    const forged = { ...payload, dimensions: [{ number: 1, content: 'INVENTED evidence' }] };
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: forged, contextSig: sig, contextExp: exp })).resolves.toBe(false);
  });

  it('rejects the signature on another analysis or other dimensions (no mode flip)', async () => {
    const { sig, exp } = await signed();
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-2', dimensions: [9, 11], priorPayload: payload, contextSig: sig, contextExp: exp })).resolves.toBe(false);
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [3, 8], priorPayload: payload, contextSig: sig, contextExp: exp })).resolves.toBe(false);
  });

  it('rejects expired, missing or wrong-secret signatures', async () => {
    const { sig, exp } = await signed();
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: payload, contextSig: sig, contextExp: exp, nowMs: exp + 1 })).resolves.toBe(false);
    await expect(verifyProjectiveContextSig({ secret: SECRET, analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: payload, contextSig: undefined, contextExp: exp })).resolves.toBe(false);
    await expect(verifyProjectiveContextSig({ secret: 'other-secret', analysisId: 'analysis-1', dimensions: [9, 11], priorPayload: payload, contextSig: sig, contextExp: exp })).resolves.toBe(false);
  });
});
