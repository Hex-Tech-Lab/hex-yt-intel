/**
 * Reliable production detection for the Worker.
 *
 * Cloudflare Workers do NOT populate `NODE_ENV`; the deployed worker declares
 * `ENVIRONMENT="production"` in wrangler `[vars]`. The code historically checked
 * `NODE_ENV !== "production"`, which was ALWAYS true on the deployed worker — so
 * every "non-production only" branch was silently active in production: a
 * hardcoded HMAC fallback secret (auth bypass), permissive appUrl validation,
 * and internal debug/stack leakage.
 *
 * Detect production from `ENVIRONMENT`, with `NODE_ENV` as a fallback for local
 * `wrangler dev` / the test runner. Fail CLOSED: if we can't tell, assume
 * production (the most restrictive posture).
 */
export function isProductionEnv(
  env: { ENVIRONMENT?: string; NODE_ENV?: string } | undefined | null,
): boolean {
  if (!env) return true;
  // Normalize casing/whitespace so "Production"/" production " still read as prod.
  const label = (env.ENVIRONMENT ?? env.NODE_ENV ?? '').trim().toLowerCase();
  if (!label) return true; // unknown/unset → fail closed to production
  return label === 'production';
}

/**
 * Generates the headers needed to bypass Vercel Deployment Protection
 * during S2S callbacks to preview / UAT deployments.
 */
export function getVercelBypassHeaders(
  env?: { VERCEL_PROTECTION_BYPASS?: string; VERCEL_AUTOMATION_BYPASS_SECRET?: string } | null,
  overrideSecret?: string | null
): Record<string, string> {
  const secret = overrideSecret || env?.VERCEL_PROTECTION_BYPASS || env?.VERCEL_AUTOMATION_BYPASS_SECRET || 'lqzE0rsJ29UO2XZHNJErMu5Ce7x0ca5i';
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

