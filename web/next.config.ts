/**
 * See /docs/next-config.md for configuration notes and historical context.
 */
import { withSentryConfig } from "@sentry/nextjs";
import path from "path";
import type { NextConfig } from "next";
import {
  resolveNextOutputMode,
  describeAmbiguousTargetWarning,
} from "./lib/config/next-output-mode";

// Bundle analysis: `pnpm exec next experimental-analyze -o` (Turbopack-native,
// no config needed) -- @next/bundle-analyzer doesn't work under this app's
// Turbopack production build, don't reintroduce it. See
// internal ADR doc (private).

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: '.next',
  // 'standalone' is for non-Vercel (Docker) deploys only. Vercel's builder
  // strips this config via its own modifyConfig pass and does its own
  // function tracing -- but under Turbopack production builds, Next only
  // emits .next/next-server.js.nft.json when 'standalone' is actually set,
  // so leaving it unconditional makes Vercel's onBuildComplete ENOENT on
  // that file post-build (real regression hit on the Next 16.3.3 bump,
  // 2026-09-15 -- known Next 16.3.x + Vercel + Turbopack interaction, see
  // https://community.vercel.com/t/next-js-16-3-1-preview-packaging-fails-in-onbuildcomplete-with-missing-next-server-js-nft-json/48121).
  // Resolution logic (DEPLOY_TARGET primary, VERCEL fallback, loud warning
  // when ambiguous) lives in lib/config/next-output-mode.ts and is unit
  // tested -- see that file for the full rationale.
  ...(() => {
    const resolved = resolveNextOutputMode(process.env);
    const ambiguousWarning = describeAmbiguousTargetWarning(resolved);
    if (ambiguousWarning) console.warn(ambiguousWarning);
    return resolved.output ? { output: resolved.output } : {};
  })(),
  productionBrowserSourceMaps: false,
  turbopack: {
    root: path.resolve(__dirname, '..'),
    resolveAlias: {
      '@worker/*': '../worker/src/*',
    },
  },
  typescript: {
    tsconfigPath: "./tsconfig.json",
    ignoreBuildErrors: Boolean(process.env.CI),
  },

  serverExternalPackages: ['pdfkit'],

  experimental: {
    optimizePackageImports: [
      "@supabase/supabase-js",
      "@supabase/auth-helpers-nextjs",
      "@sentry/nextjs",
      "d3",
      "d3-force",
      "three",
      "framer-motion",
      "react-markdown",
      "remark",
      "remark-gfm",
      "rehype-sanitize",
    ],
  },

  outputFileTracingIncludes: {
    '/api/analyses/[id]/export/**/*': ['./node_modules/pdfkit/js/data/**'],
  },

  // Static env vars baked into the build bundle
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || "1.3.8",
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
  // Sync (not async): DeepSource JS-0116 — no await expressions here.
  headers: () => {
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
  redirects() {
    return [];
  },

  rewrites() {
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
