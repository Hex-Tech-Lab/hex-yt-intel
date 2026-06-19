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

    if (envAppUrl) {
      const parsedEnv = new URL(envAppUrl);
      if (origin === parsedEnv.origin.toLowerCase()) {
        return true;
      }
    }

    if (allowedOrigins) {
      const list = allowedOrigins.split(",").map((o) => o.trim().toLowerCase());
      if (list.includes(origin)) {
        return true;
      }
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!isProd || hostname.endsWith(".vercel.app") || hostname === "yt-intel.getmytestdrive.com") {
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".vercel.app") ||
        hostname === "yt-intel.getmytestdrive.com"
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
};
