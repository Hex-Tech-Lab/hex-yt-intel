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
 * Verify a server-to-server content signature.
 *
 * When `binding` is supplied (the Cloudflare Worker's newer persist calls), the
 * signature is bound to a specific analysis id and carries an expiry — this
 * prevents an observed persist body from being replayed indefinitely or against
 * a different analysis. When omitted, we fall back to the legacy content-only
 * signature so a non-atomic worker/web rollout can't cause a persistence outage.
 * Remove the legacy branch once the worker signer is fully deployed.
 */
export async function verifyContentSig(
  message: string,
  sig: string,
  binding?: { analysisId: string; exp: number }
): Promise<boolean> {
  if (binding) {
    if (!Number.isFinite(binding.exp) || Date.now() > binding.exp) return false;
    const bound = `persist:${binding.analysisId}:${binding.exp}:${message}`;
    const expected = await hmacHex(env.streamHmacSecret, bound);
    return timingSafeEqualHex(expected, sig);
  }
  const expected = await hmacHex(env.streamHmacSecret, message);
  return timingSafeEqualHex(expected, sig);
}
