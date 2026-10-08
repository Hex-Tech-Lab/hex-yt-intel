/**
 * Phase C shadow runner (2026-10-08): JEV intensities reach the dispatcher,
 * persistGhostRow is injected, and both grounded-claims writes carry a bound
 * signature that Vercel's real verifyContentSig accepts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalJson } from '../../../web/lib/utils/canonical-json';

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const GROUNDED = { claims: [{ id: 'claim_01' }], unknowns: ['u1'], metadata: { speakerCount: 2, durationSeconds: 60, classification: 'S2' } };
const dispatchAnalysis = vi.fn();
vi.mock('../services/EpistemicPipelineDispatcher', () => ({
  EpistemicPipelineDispatcher: vi.fn().mockImplementation(function MockDispatcher() { return { dispatchAnalysis }; }),
}));
const analyze = vi.fn();
vi.mock('../services/sensor-fusion/heuristics/jev-text-parser', () => ({
  JevTextParser: vi.fn().mockImplementation(function MockParser() { return { analyze }; }),
}));

const SECRET = 'test-hmac-secret';
const ANALYSIS_ID = 'analysis-shadow-1';

async function verifyOnVercel(body: { analysisId: string; groundedClaims: unknown; degradedSensors: boolean; exp: number; contentSig: string }): Promise<boolean> {
  const prev = process.env.STREAM_HMAC_SECRET;
  process.env.STREAM_HMAC_SECRET = SECRET;
  try {
    const { env } = await import('../../../web/lib/env');
    const { verifyEpistemicClaims } = await import('../../../web/lib/config/epistemic-shadow');
    const canonical = canonicalJson({ analysisId: body.analysisId, groundedClaims: body.groundedClaims, degradedSensors: body.degradedSensors });
    return await verifyEpistemicClaims({ secret: env.streamHmacSecret, analysisId: body.analysisId, exp: body.exp, content: canonical, sig: body.contentSig });
  } finally {
    if (prev === undefined) delete process.env.STREAM_HMAC_SECRET; else process.env.STREAM_HMAC_SECRET = prev;
  }
}

describe('runEpistemicShadow', () => {
  beforeEach(() => {
    dispatchAnalysis.mockReset();
    analyze.mockReset();
  });

  function params(fetchImpl: typeof fetch) {
    return {
      analysisId: ANALYSIS_ID, videoId: 'v1', transcript: 'a transcript', durationSeconds: 60,
      appUrl: 'https://app.example.test/', signingSecret: SECRET, openRouterApiKey: 'k',
      promptBuilder: {} as never, cascade: {} as never, fetchImpl,
    };
  }

  it('feeds JEV intensities to the dispatcher, injects persistGhostRow, and signs both writes so Vercel accepts them', async () => {
    analyze.mockResolvedValue({ direct_address_intensity: 3, procedural_instruction_intensity: 1, tangential_fluff_intensity: 2, turn_marker_count: 4 });
    dispatchAnalysis.mockImplementation(async (input: { persistGhostRow: (payload: unknown) => Promise<boolean> }) => {
      expect(await input.persistGhostRow(GROUNDED)).toBe(true);
      return { classification: { route: 'S2', degradedSensors: true }, groundedExtraction: GROUNDED, projectiveSynthesis: {}, latencyMs: 5 };
    });
    const posts: Array<{ url: string; body: any }> = [];
    const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    await runEpistemicShadow(params(fetchImpl));

    const input = dispatchAnalysis.mock.calls[0]![0];
    expect(input).toMatchObject({ directAddressIntensity: 3, proceduralInstructionIntensity: 1, tangentialFluffIntensity: 2, transcript: 'a transcript' });
    expect(posts).toHaveLength(2);
    expect(posts[0]!.url).toBe(`https://app.example.test/api/analyses/${ANALYSIS_ID}/grounded-claims`);
    expect(posts[0]!.body.degradedSensors).toBe(false);
    expect(posts[1]!.body.degradedSensors).toBe(true);
    for (const post of posts) expect(await verifyOnVercel(post.body)).toBe(true);
  });

  it('routes with neutral intensities when JEV fails, and never throws when the dispatcher fails', async () => {
    analyze.mockRejectedValue(new Error('jev down'));
    dispatchAnalysis.mockRejectedValue(new Error('cascade down'));
    const { runEpistemicShadow } = await import('../services/EpistemicShadowRunner');
    await expect(runEpistemicShadow(params(vi.fn() as unknown as typeof fetch))).resolves.toBeUndefined();
    expect(dispatchAnalysis.mock.calls[0]![0]).toMatchObject({ directAddressIntensity: 0, proceduralInstructionIntensity: 0, tangentialFluffIntensity: 0 });
  });
});
