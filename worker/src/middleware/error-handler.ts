import type { ErrorHandler } from "hono";
import * as Sentry from "@sentry/cloudflare";
import { isProductionEnv } from "../env-utils";

export const errorHandler: ErrorHandler = (err, c) => {
  const errorMessage = err instanceof Error ? err.message : "Unknown error";
  const errorStack = err instanceof Error ? err.stack : "";

  console.error("[Worker] Uncaught error:", {
    message: errorMessage,
    stack: errorStack,
    url: c.req.url,
    method: c.req.method,
  });

  // 2026-08-28 (stream-5 RCA): this was the only worker error path with no
  // Sentry visibility — 37 capture sites elsewhere, zero here — so uncaught
  // route throws surfaced only as opaque 500s ("Internal server error") with
  // no way to correlate the client-reported failure to a stack. captureException
  // returns the Sentry event id; echoing it as `errorId` lets a client-reported
  // 500 body be joined against the Sentry event carrying the full stack.
  const errorId = Sentry.captureException(err, {
    tags: { component: "worker-error-handler" },
    extra: { url: c.req.url, method: c.req.method },
  });

  // Never leak error messages/stacks to clients in production. Detect prod from
  // the worker's ENVIRONMENT var (NODE_ENV is unset on Workers); fail closed.
  const isDev = !isProductionEnv(c.env as { ENVIRONMENT?: string; NODE_ENV?: string });

  return c.json(
    {
      error: "Internal server error",
      errorId,
      ...(isDev && { message: errorMessage, stack: errorStack }),
    },
    500,
  );
};
