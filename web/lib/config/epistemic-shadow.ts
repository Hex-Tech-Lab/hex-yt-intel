/**
 * Phase C shadow mode (2026-10-08): Vercel decides whether an analysis also
 * runs the Epistemic pipeline (Settings Registry `analysis.pipeline.epistemic`,
 * default false) and proves that decision to the worker with a short-lived
 * bound signature. The worker has no DB access (ADR 005), and the browser
 * relays the request, so an unsigned flag would let any caller switch on the
 * costlier epistemic path. Shared by Vercel (sign) and the worker (verify),
 * same layout as projective-context.ts.
 *
 * Shadow mode never changes the live response: the legacy dimension stream
 * still serves the dashboard; the dispatcher's grounded claims are persisted
 * to analyses.grounded_claims / unknowns / degraded_sensors in the background.
 */

/** Bound-signature purpose tag for the shadow-run grant. */
export const EPISTEMIC_SHADOW_PURPOSE = 'epistemic-shadow' as const;

/** Purpose tag for the worker -> Vercel grounded-claims persist call. */
export const EPISTEMIC_CLAIMS_PURPOSE = 'epistemic-claims' as const;

/** The grant only needs to outlive the first bundle's stream request. */
export const EPISTEMIC_SHADOW_TTL_MS = 10 * 60 * 1000;

/** Registry key gating shadow mode. */
export const EPISTEMIC_PIPELINE_FLAG_KEY = 'analysis.pipeline.epistemic' as const;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time hex comparison (same logic as the worker's timingSafeEqualHex). */
function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

/** Vercel side: grant shadow mode for one analysis. */
export async function signEpistemicShadow(secret: string, analysisId: string, nowMs: number = Date.now()): Promise<{ sig: string; exp: number }> {
  const exp = nowMs + EPISTEMIC_SHADOW_TTL_MS;
  const sig = await hmacSha256Hex(secret, `${EPISTEMIC_SHADOW_PURPOSE}:${analysisId}:${exp}:on`);
  return { sig, exp };
}

/** Worker side: true only for an unexpired grant signed for exactly this analysis. */
export async function verifyEpistemicShadowSig(params: {
  secret: string;
  analysisId: string;
  sig: unknown;
  exp: unknown;
  nowMs?: number;
}): Promise<boolean> {
  const { secret, analysisId, sig, exp } = params;
  if (!secret || !analysisId || typeof sig !== 'string' || typeof exp !== 'number' || !Number.isFinite(exp)) return false;
  if ((params.nowMs ?? Date.now()) > exp) return false;
  const expected = await hmacSha256Hex(secret, `${EPISTEMIC_SHADOW_PURPOSE}:${analysisId}:${exp}:on`);
  return timingSafeEqualHex(expected, sig);
}

/**
 * Worker side: sign a grounded-claims persist for one analysis. Same message
 * layout as the shared bound-content signatures (`purpose:id:exp:content`),
 * kept here so the Phase C wiring needs no changes to the stream-token module.
 */
export function signEpistemicClaims(secret: string, analysisId: string, exp: number, content: string): Promise<string> {
  return hmacSha256Hex(secret, `${EPISTEMIC_CLAIMS_PURPOSE}:${analysisId}:${exp}:${content}`);
}

/** Vercel side: true only for an unexpired grounded-claims signature for exactly this analysis and content. */
export async function verifyEpistemicClaims(params: {
  secret: string;
  analysisId: string;
  exp: number;
  content: string;
  sig: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!params.secret || !Number.isFinite(params.exp) || (params.nowMs ?? Date.now()) > params.exp) return false;
  const expected = await signEpistemicClaims(params.secret, params.analysisId, params.exp, params.content);
  return timingSafeEqualHex(expected, params.sig);
}
