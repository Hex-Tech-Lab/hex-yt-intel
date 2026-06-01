import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: '.next',
  output: 'standalone',
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  typescript: { 
    tsconfigPath: "./tsconfig.json",
    ignoreBuildErrors: !!process.env.CI,
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

  // Static env vars baked into the build bundle
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || "1.1.2",
  },

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
