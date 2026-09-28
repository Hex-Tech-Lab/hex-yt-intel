import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  // 0.1 (RCA 2026-09-28, ~1GB tab): client tracing at 1.0 retained every
  // OTel span for all-day sessions. Server/edge keep their own rates.
  tracesSampleRate: 0.1,
});