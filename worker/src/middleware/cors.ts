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
  "https://yt-intel.getmytestdrive.com",
  "https://v-intel.getmytestdrive.com",
];

// Kept separate from PRODUCTION_ORIGINS: isValidAppUrl must reject localhost
// as a callback target when isProd is true (trusting it there would let a
// request claim a same-origin callback into the worker's own dev-only trust
// path). resolveCorsOrigin has no such prod/dev distinction -- CORS preflight
// from a real browser never carries a localhost Origin in production traffic
// anyway -- so it trusts both lists unconditionally.
const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3005"];

const OWN_VERCEL_PREVIEW_RE = /^hex-yt-intel-[a-z0-9-]+\.vercel\.app$/;

/** True for this app's own production/legacy origins or its own preview deployments -- never any arbitrary *.vercel.app host. */
function isTrustedProductionOrigin(origin: string): boolean {
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return OWN_VERCEL_PREVIEW_RE.test(hostname);
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (LOCAL_DEV_ORIGINS.includes(origin)) return origin;
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
  } catch {
    return false;
  }
}

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
};
