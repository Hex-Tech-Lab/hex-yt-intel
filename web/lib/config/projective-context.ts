/**
 * R2b (2026-09-29): signed, server-loaded grounded context for the projective
 * bundle (closes audit finding 8, the persist-ACK race, and the "client-chosen
 * grounded evidence" trust gap from the #363 review).
 *
 * Vercel reads the PERSISTED grounded chunks, builds prior_payload, and signs
 * it bound to the analysis id, an expiry, the projective bundle's dimensions
 * and a hash of the exact payload. The worker (no DB access, ADR 005) accepts a
 * prior_payload only with a valid signature, so the browser can neither invent
 * evidence nor flip a bundle's epistemic mode.
 *
 * Pure, dependency-free and shared by web (signer) and worker (verifier), the
 * same way web/lib/config/prior-payload.ts is shared. Uses crypto.subtle
 * (available in Node 18+ and Cloudflare Workers).
 */

/** Bound-signature purpose tag; see web/lib/stream-token.ts#boundContentMessage. */
export const PROJECTIVE_CONTEXT_PURPOSE = 'projective-context' as const;

/** How long a signed context stays valid (the projective call starts right after). */
export const PROJECTIVE_CONTEXT_TTL_MS = 10 * 60 * 1000;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The signed content: the projective bundle's dimensions (sorted) plus the
 * sha256 of the payload's JSON. The payload travels client -> worker as parsed
 * JSON; JSON.parse/JSON.stringify preserve key insertion order, so both sides
 * hash the same string.
 */
export async function projectiveContextContent(
  dimensions: readonly number[],
  priorPayload: unknown
): Promise<string> {
  const dims = [...dimensions].sort((left, right) => left - right).join(',');
  return `${dims}:${await sha256Hex(JSON.stringify(priorPayload))}`;
}

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

/**
 * Worker-side verification of a Vercel-signed projective context. Message
 * layout = the shared bound-content format `${purpose}:${id}:${exp}:${content}`
 * (web/lib/stream-token.ts#boundContentMessage, worker/src/crypto.ts#signBoundContent).
 */
export async function verifyProjectiveContextSig(params: {
  secret: string;
  analysisId: string;
  dimensions: readonly number[];
  priorPayload: unknown;
  contextSig: unknown;
  contextExp: unknown;
  nowMs?: number;
}): Promise<boolean> {
  const { secret, analysisId, dimensions, priorPayload, contextSig, contextExp } = params;
  if (!secret || typeof contextSig !== 'string' || typeof contextExp !== 'number' || !Number.isFinite(contextExp)) return false;
  if ((params.nowMs ?? Date.now()) > contextExp) return false;
  const content = await projectiveContextContent(dimensions, priorPayload);
  const expected = await hmacSha256Hex(secret, `${PROJECTIVE_CONTEXT_PURPOSE}:${analysisId}:${contextExp}:${content}`);
  return timingSafeEqualHex(expected, contextSig);
}

