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
  if (env.ENVIRONMENT) return env.ENVIRONMENT === 'production';
  if (env.NODE_ENV) return env.NODE_ENV === 'production';
  return true;
}
