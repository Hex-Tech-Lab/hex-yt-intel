import { env } from '@/lib/env';

/**
 * Shared-secret HMAC for the direct browser->worker streaming flow.
 *
 * This implementation uses the Web Crypto API to ensure absolute cryptographic
 * parity between Vercel (Node.js/Edge) and Cloudflare Workers.
 */
const TOKEN_TTL_MS = 120_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  if (!secret) throw new Error('STREAM_HMAC_SECRET is not configured');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time hex compare (avoids early-exit timing leaks).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signStreamToken(videoId: string, analysisId: string, models: string[] = []): Promise<{ sig: string; exp: number }> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const modelStr = [...models].sort().join(',');
  const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
  return { sig: await hmacHex(env.streamHmacSecret, msg), exp };
}

export async function signChatToken(conversationId: string, userId: string, models: string[] = []): Promise<{ sig: string; exp: number }> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const modelStr = [...models].sort().join(',');
  const msg = `chat:${conversationId}:${userId}:${exp}:${modelStr}`;
  return { sig: await hmacHex(env.streamHmacSecret, msg), exp };
}

export async function verifyChatToken(conversationId: string, userId: string, exp: number, sig: string, models: string[] = []): Promise<boolean> {
  if (Date.now() > exp) return false;
  const modelStr = [...models].sort().join(',');
  const msg = `chat:${conversationId}:${userId}:${exp}:${modelStr}`;
  const expected = await hmacHex(env.streamHmacSecret, msg);
  return timingSafeEqualHex(expected, sig);
}

/**
 * The two server-to-server persist flows that sign content with the shared HMAC
 * secret. The purpose tag is part of the signed message, so a signature minted
 * for one flow can never be replayed into the other.
 */
export type BoundSigPurpose = 'persist' | 'chat-persist';

/**
 * The canonical message for a bound, time-limited S2S content signature. MUST be
 * byte-identical to the worker's signer (worker/src/crypto.ts#signBoundContent),
 * or signatures won't verify across the Vercel/Cloudflare boundary.
 */
export function boundContentMessage(purpose: BoundSigPurpose, id: string, exp: number, content: string): string {
  return `${purpose}:${id}:${exp}:${content}`;
}

/**
 * Verify a server-to-server content signature.
 *
 * When `binding` is supplied (the Cloudflare Worker's newer persist calls), the
 * signature is bound to a specific resource id + purpose and carries an expiry —
 * this prevents an observed persist body from being replayed indefinitely, cross-
 * flow, or against a different resource. When omitted, we fall back to the legacy
 * content-only signature so a non-atomic worker/web rollout can't cause a persist
 * outage. Remove the legacy branch once the worker signer is fully deployed.
 *
 * Dual-secret support (STREAM_HMAC_SECRET + DEV_HMAC_SECRET) is only enabled in
 * non-production environments to ease rollout. In production, only STREAM_HMAC_SECRET
 * is accepted to prevent accidental secret widening.
 */
export async function verifyContentSig(
  message: string,
  sig: string,
  binding?: { purpose: BoundSigPurpose; id: string; exp: number }
): Promise<boolean> {
  const primarySecret = env.streamHmacSecret;
  const devSecret = process.env.DEV_HMAC_SECRET;
  const secretsToTry = [primarySecret];

  // Only accept DEV_HMAC_SECRET fallback in non-production environments
  const isProduction = env.isProduction;
  if (!isProduction && devSecret) {
    secretsToTry.push(devSecret);
  }

  for (const secret of secretsToTry) {
    if (!secret) continue;

    if (binding) {
      if (!Number.isFinite(binding.exp) || Date.now() > binding.exp) continue;
      const expected = await hmacHex(secret, boundContentMessage(binding.purpose, binding.id, binding.exp, message));
      if (timingSafeEqualHex(expected, sig)) return true;
    } else {
      const expected = await hmacHex(secret, message);
      if (timingSafeEqualHex(expected, sig)) return true;
    }
  }

  return false;
}
