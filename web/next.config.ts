import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { tsconfigPath: "./tsconfig.json" },
};

export default withSentryConfig(nextConfig, {
  org: "hex-tech-lab",
  project: "hex-yt-intel",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: false,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
});
