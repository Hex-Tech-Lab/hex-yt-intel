import type { MiddlewareHandler } from "hono";

// Worker-side code constant, not Settings-Registry-driven: the CF Worker has
// no direct DB access by design (ADR 005 -- resolved config is forwarded
// through the signed stream payload from Vercel, not queried per-request),
// and a live DB lookup on every CORS preflight would add a real latency/
// reliability regression. Update this array by hand when the domain changes.
const ALLOWED_ORIGINS = [
  "https://hex-yt-intel.vercel.app",
  // New canonical production domain (2026-08-19 migration).
  "https://getvintel.com",
  "https://www.getvintel.com",
  "https://yt-intel.getmytestdrive.com",
  // Parallel domain cutover (2026-07-25): both getmytestdrive.com domains
  // still valid, currently-live parallel-cutover domains per CLAUDE.md's
  // Infrastructure Coordinates section; drop once the hard cutoff to
  // getvintel.com is confirmed by the user.
  "https://v-intel.getmytestdrive.com",
  "http://localhost:3000",
  "http://localhost:3005",
];

export function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed))) {
    return origin;
  }
  if (origin.startsWith("https://hex-yt-intel-") && origin.endsWith(".vercel.app")) {
    return origin;
  }
  return null;
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

    const originMap: Record<string, boolean> = {
      envMatch: parsedEnv ? origin === parsedEnv : false,
      listMatch: originList.includes(origin),
      localhost: hostname === "localhost" || hostname === "127.0.0.1",
      vercel: hostname.endsWith(".vercel.app"),
      // New canonical production domain (2026-08-19) + parallel-cutover
      // getmytestdrive.com domains (2026-07-25) -- all valid until hard cutoff.
      production:
        hostname === "getvintel.com" ||
        hostname === "www.getvintel.com" ||
        hostname === "yt-intel.getmytestdrive.com" ||
        hostname === "v-intel.getmytestdrive.com",
    };

    if (originMap.envMatch || originMap.listMatch) return true;
    if (!isProd && (originMap.localhost || originMap.vercel)) return true;
    if (originMap.vercel || originMap.production) return true;

    return false;
  } catch {
    return false;
  }
}

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
};
