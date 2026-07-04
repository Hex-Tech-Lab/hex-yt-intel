export const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Per-isolate memoization cache for secretFingerprint (secrets don't change at runtime).
const _fpCache = new Map<string, string>();

/**
 * Non-reversible fingerprint of a secret, for diagnostics. It's the HMAC of a
 * fixed label, truncated — two systems that share a secret produce the same
 * fingerprint, so ops can compare Vercel vs the Worker in logs WITHOUT ever
 * logging the secret itself. Returns "unset" for a missing secret.
 */
export const secretFingerprint = async (secret: string | undefined | null): Promise<string> => {
  if (!secret) return 'unset';
  // Memoize per isolate: the secrets don't change at runtime, so an attacker
  // spamming the 401 path can't force repeated HMAC work for diagnostics.
  const cached = _fpCache.get(secret);
  if (cached) return cached;
  const fp = (await hmacHex(secret, 'hmac-fingerprint-v1')).slice(0, 10);
  _fpCache.set(secret, fp);
  return fp;
};

/** The two server-to-server persist flows that sign content with the shared secret. */
export type BoundSigPurpose = 'persist' | 'chat-persist';

/**
 * Sign a bound, time-limited server-to-server content signature. The purpose tag
 * and resource id are part of the signed message so a signature can't be replayed
 * cross-flow or against a different resource, and `exp` bounds the replay window.
 * The message layout MUST stay byte-identical to the Vercel verifier
 * (web/lib/stream-token.ts#boundContentMessage).
 */
export const signBoundContent = (
  secret: string,
  purpose: BoundSigPurpose,
  id: string,
  exp: number,
  content: string,
): Promise<string> => hmacHex(secret, `${purpose}:${id}:${exp}:${content}`);
