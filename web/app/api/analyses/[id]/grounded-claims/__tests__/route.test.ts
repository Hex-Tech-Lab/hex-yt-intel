import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canonicalJson } from '@/lib/utils/canonical-json';
import { signEpistemicClaims } from '@/lib/config/epistemic-shadow';

const persistGroundedClaims = vi.fn();
vi.mock('@/lib/adapters/SupabaseEpistemicAdapter', () => ({ SupabaseEpistemicAdapter: { persistGroundedClaims } }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'analysis-gc-1';
const CLAIMS = { claims: [{ id: 'claim_01' }], unknowns: ['nothing on pricing'], metadata: { classification: 'S1' } };

async function signedBody(overrides: Record<string, unknown> = {}, secret = SECRET) {
  const exp = Date.now() + 60_000;
  const degradedSensors = false;
  const contentSig = await signEpistemicClaims(secret, ANALYSIS_ID, exp,
    canonicalJson({ analysisId: ANALYSIS_ID, groundedClaims: CLAIMS, degradedSensors }));
  return { analysisId: ANALYSIS_ID, groundedClaims: CLAIMS, degradedSensors, exp, contentSig, ...overrides };
}

async function post(body: unknown, id = ANALYSIS_ID) {
  const { POST } = await import('../route');
  const req = new NextRequest(`https://app.example.test/api/analyses/${id}/grounded-claims`, { method: 'POST', body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/analyses/[id]/grounded-claims', () => {
  const prev = process.env.STREAM_HMAC_SECRET;
  beforeEach(() => {
    process.env.STREAM_HMAC_SECRET = SECRET;
    persistGroundedClaims.mockReset();
    persistGroundedClaims.mockResolvedValue({ updated: true });
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev;
  });

  it('persists claims, unknowns and the degraded flag for a valid worker signature', async () => {
    const res = await post(await signedBody());
    expect(res.status).toBe(200);
    expect(persistGroundedClaims).toHaveBeenCalledWith({ analysisId: ANALYSIS_ID, groundedClaims: CLAIMS, unknowns: CLAIMS.unknowns, degradedSensors: false });
  });

  it('rejects a body whose content no longer matches the signature (401, no write)', async () => {
    const res = await post(await signedBody({ degradedSensors: true }));
    expect(res.status).toBe(401);
    expect(persistGroundedClaims).not.toHaveBeenCalled();
  });

  it('rejects a signature made with the wrong secret', async () => {
    const res = await post(await signedBody({}, 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(persistGroundedClaims).not.toHaveBeenCalled();
  });

  it('rejects a path/body analysis id mismatch', async () => {
    const res = await post(await signedBody(), 'another-analysis');
    expect(res.status).toBe(400);
    expect(persistGroundedClaims).not.toHaveBeenCalled();
  });

  it('returns 404 when the analysis row does not exist', async () => {
    persistGroundedClaims.mockResolvedValue({ updated: false });
    const res = await post(await signedBody());
    expect(res.status).toBe(404);
  });
});
