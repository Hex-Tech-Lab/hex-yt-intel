import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { tsconfigPath: "./tsconfig.json" },

  // Static env vars baked into the build bundle
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",
  },

  // Externalise browser-only packages so they are not bundled into
  // the server component tree and do not trigger SSR/SSG crashes.
  serverExternalPackages: ["next-auth"],

  // ============================================================================
  // PRODUCTION PERFORMANCE BUDGETS
  // ============================================================================
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 50,
  },

  // ============================================================================
  // CACHING STRATEGY
  // ============================================================================
  headers: async () => {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/_next/image/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=60, stale-while-revalidate=31536000",
          },
        ],
      },
      {
        source: "/public/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path((?!_next|public).*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
    ];
  },

  // ============================================================================
  // REDIRECTS & REWRITES
  // ============================================================================
  async redirects() {
    return [];
  },

  async rewrites() {
    return [];
  },

  // ============================================================================
  // EXPERIMENTAL FEATURES
  // ============================================================================
  experimental: {
    optimizePackageImports: [
      "@supabase/supabase-js",
      "@supabase/auth-helpers-nextjs",
      "@sentry/nextjs",
    ],
  },

  // ============================================================================
  // LOGGING
  // ============================================================================
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: "hex-tech-lab",
  project: "hex-yt-intel",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  debug: process.env.NODE_ENV === "development",
});
