import type { MiddlewareHandler } from "hono";

// Invariant: this is a worker-side code constant, not Settings-Registry-driven
// -- the Worker has no direct DB access (ADR 005). Update by hand when the
// domain changes; migration history/rationale lives in docs/, not here.
//
// Single source of truth for BOTH CORS preflight (resolveCorsOrigin) and
// callback-target validation (isValidAppUrl). Previously these were two
// independently-maintained allowlists in the same file -- one got the
// getvintel.com migration and a spoof fix, the other didn't, until a review
// caught the drift (real P0 on PR #244, fixed same session). Never
// reintroduce a second copy of this list.
const PRODUCTION_ORIGINS = [
  "https://hex-yt-intel.vercel.app",
  "https://getvintel.com",
  "https://www.getvintel.com",
  // UAT environment (see wrangler.toml uat env's app origin): without this,
  // every browser request from uat.getvintel.com resolved to a null CORS
  // origin — even preflights returned no access-control-allow-origin —
  // surfacing to the frontend as an opaque "Failed to fetch" (real incident
  // 2026-10-06).
  "https://uat.getvintel.com",
  "https://yt-intel.getmytestdrive.com",
  "https://v-intel.getmytestdrive.com",
];

// Kept separate from PRODUCTION_ORIGINS: localhost trust is dev-gated for BOTH
// resolveCorsOrigin and isValidAppUrl (prod-gated via isProd, defaulting
// fail-closed to production). A real browser never carries a localhost Origin
// against the deployed worker, and a localhost callback target is only
// meaningful in local dev — trusting either in production would let a request
// claim the worker's dev-only trust path.
const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3005"];

const OWN_VERCEL_PREVIEW_RE = /^hex-yt-intel-[a-z0-9-]+\.vercel\.app$/;

/** True for this app's own production/legacy origins or its own preview deployments -- never any arbitrary *.vercel.app host. */
function isTrustedProductionOrigin(origin: string): boolean {
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return OWN_VERCEL_PREVIEW_RE.test(hostname);
  } catch (error) {
    console.error("[CORS]", error);
    return false;
  }
}

/**
 * Prod-gated CORS origin resolution. Localhost trust is dev-only: in
 * production (or when production-ness cannot be determined — fail closed)
 * localhost origins resolve to null so no dev trust path leaks. Callers
 * pass `isProd` from isProductionEnv(env); defaults to true.
 */
export function resolveCorsOrigin(
  origin: string | undefined,
  isProd: boolean = true,
): string | null {
  if (!origin) return null;
  if (!isProd && LOCAL_DEV_ORIGINS.includes(origin)) return origin;
  return isTrustedProductionOrigin(origin) ? origin : null;
}

export function isValidAppUrl(
  urlStr: string | undefined,
  envAppUrl: string | undefined,
  allowedOrigins?: string,
  isProd?: boolean,
): boolean {
  if (!urlStr) return true;

  try {
    const parsedUrl = new URL(urlStr);
    const origin = parsedUrl.origin.toLowerCase();
    const hostname = parsedUrl.hostname.toLowerCase();

    const parsedEnv = envAppUrl ? new URL(envAppUrl).origin.toLowerCase() : null;
    const originList = allowedOrigins
      ? allowedOrigins.split(",").map((o) => o.trim().toLowerCase())
      : [];

    if (parsedEnv && origin === parsedEnv) return true;
    if (originList.includes(origin)) return true;

    const localhost = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isProd && localhost) return true;

    return isTrustedProductionOrigin(origin);
  } catch (error) {
    console.error("[CORS]", error);
    return false;
  }
}

export const corsMiddleware: MiddlewareHandler = async (ctx, next) => {
  await next();
};
