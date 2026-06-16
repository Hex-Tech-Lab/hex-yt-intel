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
  // Use a stable, simple separator format. Sort models to ensure order-independence.
  const modelStr = [...models].sort().join(',');
  const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
  return { sig: hmacHex(msg), exp };
}

/**
 * Chat streaming token: gates the direct browser->worker /chat-stream flow so the
 * public worker endpoint can't be driven to burn OpenRouter quota. Bound to the
 * conversation + owner + expiry. The worker verifies with the identical message format.
 */
export function signChatToken(conversationId: string, userId: string, models: string[] = []): { sig: string; exp: number } {
  const exp = Date.now() + TOKEN_TTL_MS;
  const modelStr = [...models].sort().join(',');
  const msg = `chat:${conversationId}:${userId}:${exp}:${modelStr}`;
  return { sig: hmacHex(msg), exp };
}

export function verifyChatToken(conversationId: string, userId: string, exp: number, sig: string, models: string[] = []): boolean {
  if (Date.now() > exp) return false;
  const modelStr = [...models].sort().join(',');
  const msg = `chat:${conversationId}:${userId}:${exp}:${modelStr}`;
  return safeEqualHex(hmacHex(msg), sig);
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