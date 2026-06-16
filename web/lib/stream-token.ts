import { createHmac, timingSafeEqual } from 'crypto';

import { env } from '@/lib/env';

/**
 * Shared-secret HMAC for the direct browser->worker streaming flow.
 *
 * - signStreamToken: Vercel mints a token bound to videoId + expiry. The worker
 *   refuses to stream without a matching token, so the public worker endpoint can't
 *   be abused to burn OpenRouter quota.
 * - verifyContentSig: the worker signs the final markdown with the same secret;
 *   Vercel /complete verifies it before persisting, so the saved record is
 *   tamper-proof even though the content arrives via client JS.
 *
 * Must use the exact same algorithm/encoding as the worker (HMAC-SHA256, hex).
 */
const TOKEN_TTL_MS = 120_000;

function hmacHex(message: string): string {
  return createHmac('sha256', env.streamHmacSecret).update(message).digest('hex');
}

export function signStreamToken(videoId: string, analysisId: string, models: string[] = []): { sig: string; exp: number } {
  const exp = Date.now() + TOKEN_TTL_MS;
  // Bind analysisId so the browser can't swap it to overwrite another row, and the
  // model cascade so the browser can't escalate to expensive models. JSON.stringify
  // (not join) so model ids containing a comma can't alias to a different cascade.
  // The worker verifies the byte-identical `videoId.analysisId.exp.JSON(models)`.
  return { sig: hmacHex(`${videoId}.${analysisId}.${exp}.${JSON.stringify(models)}`), exp };
}

/**
 * Chat streaming token: gates the direct browser->worker /chat-stream flow so the
 * public worker endpoint can't be driven to burn OpenRouter quota. Bound to the
 * conversation + owner + expiry. The worker verifies with the identical message format.
 */
export function signChatToken(conversationId: string, userId: string, models: string[] = []): { sig: string; exp: number } {
  const exp = Date.now() + TOKEN_TTL_MS;
  // Bind the per-tier chat model cascade so the worker runs exactly this list.
  // JSON.stringify (not join) — see signStreamToken; worker verifies byte-identically.
  return { sig: hmacHex(`chat.${conversationId}.${userId}.${exp}.${JSON.stringify(models)}`), exp };
}

export function verifyChatToken(conversationId: string, userId: string, exp: number, sig: string, models: string[] = []): boolean {
  if (Date.now() > exp) return false;
  return safeEqualHex(hmacHex(`chat.${conversationId}.${userId}.${exp}.${JSON.stringify(models)}`), sig);
}

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function verifyContentSig(markdown: string, sig: string): boolean {
  return safeEqualHex(hmacHex(markdown), sig);
}