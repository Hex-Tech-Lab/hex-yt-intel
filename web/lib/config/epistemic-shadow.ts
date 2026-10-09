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

/** Registry key for the grounded-claims persist retry policy (Settings Registry, never hardcoded). */
export const EPISTEMIC_PERSIST_RETRY_KEY = 'analysis.pipeline.retry.epistemic' as const;

/**
 * Bounded retry policy for the grounded-claims persist. `maxAttempts` counts the
 * first attempt; `backoffDelays[i]` is the wait before attempt i+2, so its length
 * is always maxAttempts - 1; `attemptTimeoutMs` bounds each POST.
 */
export interface EpistemicPersistRetry {
  maxAttempts: number;
  backoffDelays: number[];
  attemptTimeoutMs: number;
}

/** Used only when the registry key is absent or its value fails validation. */
export const EPISTEMIC_PERSIST_RETRY_DEFAULT: EpistemicPersistRetry = { maxAttempts: 3, backoffDelays: [250, 500], attemptTimeoutMs: 10_000 };

const MAX_PERSIST_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 60_000;
const MIN_ATTEMPT_TIMEOUT_MS = 1_000;
const MAX_ATTEMPT_TIMEOUT_MS = 60_000;
/**
 * Backoff plus all attempt timeouts must finish inside the grounded-claims signature
 * window (5 min, worker CLAIMS_SIG_TTL_MS) with margin, or late attempts would carry
 * an expired exp.
 */
const MAX_TOTAL_PERSIST_MS = 4 * 60 * 1000;

/** Field-level checks: integer ranges, delay count matching the attempts, and each delay in bounds. */
function hasValidFields(maxAttempts: unknown, backoffDelays: unknown, attemptTimeoutMs: unknown): boolean {
  if (!Number.isInteger(maxAttempts) || !Number.isInteger(attemptTimeoutMs)) return false;
  const attempts = maxAttempts as number;
  const timeout = attemptTimeoutMs as number;
  if (attempts < 1 || attempts > MAX_PERSIST_ATTEMPTS) return false;
  if (timeout < MIN_ATTEMPT_TIMEOUT_MS || timeout > MAX_ATTEMPT_TIMEOUT_MS) return false;
  if (!Array.isArray(backoffDelays) || backoffDelays.length !== attempts - 1) return false;
  return backoffDelays.every((ms) => Number.isInteger(ms) && ms >= 0 && ms <= MAX_BACKOFF_MS);
}

/** Validates a registry value into a retry policy, or null when malformed. */
export function parseEpistemicPersistRetry(value: unknown): EpistemicPersistRetry | null {
  if (typeof value !== 'object' || value === null) return null;
  const { maxAttempts, backoffDelays, attemptTimeoutMs } = value as { maxAttempts?: unknown; backoffDelays?: unknown; attemptTimeoutMs?: unknown };
  if (!hasValidFields(maxAttempts, backoffDelays, attemptTimeoutMs)) return null;
  const delays = backoffDelays as number[];
  const timeline = delays.reduce((total, ms) => total + ms, 0) + (maxAttempts as number) * (attemptTimeoutMs as number);
  if (timeline > MAX_TOTAL_PERSIST_MS) return null;
  return { maxAttempts: maxAttempts as number, backoffDelays: [...delays], attemptTimeoutMs: attemptTimeoutMs as number };
}

/** Canonical text of a retry policy, bound into the grant signature. */
function retryCanonical(retry: EpistemicPersistRetry): string {
  return `${retry.maxAttempts}:${retry.backoffDelays.join(',')}:${retry.attemptTimeoutMs}`;
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
 * Vercel side: grant shadow mode for one analysis. The retry policy is bound into
 * the signature, so a browser that relays the grant cannot raise its own attempts.
 */
export async function signEpistemicShadow(
  secret: string,
  analysisId: string,
  retry: EpistemicPersistRetry,
  nowMs: number = Date.now(),
): Promise<{ sig: string; exp: number }> {
  const exp = nowMs + EPISTEMIC_SHADOW_TTL_MS;
  const sig = await hmacSha256Hex(secret, `${EPISTEMIC_SHADOW_PURPOSE}:${analysisId}:${exp}:on:${retryCanonical(retry)}`);
  return { sig, exp };
}

/** Worker side: true only for an unexpired grant signed for exactly this analysis. */
export async function verifyEpistemicShadowSig(params: {
  secret: string;
  analysisId: string;
  sig: unknown;
  exp: unknown;
  retry: unknown;
  nowMs?: number;
}): Promise<boolean> {
  const { secret, analysisId, sig, exp } = params;
  if (!secret || !analysisId || typeof sig !== 'string' || typeof exp !== 'number' || !Number.isFinite(exp)) return false;
  const retry = parseEpistemicPersistRetry(params.retry);
  if (!retry) return false;
  if ((params.nowMs ?? Date.now()) > exp) return false;
  const expected = await hmacSha256Hex(secret, `${EPISTEMIC_SHADOW_PURPOSE}:${analysisId}:${exp}:on:${retryCanonical(retry)}`);
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
