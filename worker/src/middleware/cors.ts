import type { MiddlewareHandler } from "hono";

const ALLOWED_ORIGINS = [
  "https://hex-yt-intel.vercel.app",
  "https://yt-intel.getmytestdrive.com",
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
      production: hostname === "yt-intel.getmytestdrive.com",
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
