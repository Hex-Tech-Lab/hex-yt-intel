import * as Sentry from "@sentry/cloudflare";
import { isProductionEnv } from "../env-utils";
import { resolveCorsOrigin } from "./cors";
import type { ErrorHandler } from "hono";

export const errorHandler: ErrorHandler = (err, ctx) => {
  const errorMessage = err instanceof Error ? err.message : "Unknown error";
  const errorStack = err instanceof Error ? err.stack : "";

  console.error("[Worker] Uncaught error:", {
    message: errorMessage,
    stack: errorStack,
    url: ctx.req.url,
    method: ctx.req.method,
  });

  // 2026-08-28 (stream-5 RCA): this was the only worker error path with no
  // Sentry visibility — 37 capture sites elsewhere, zero here — so uncaught
  // route throws surfaced only as opaque 500s ("Internal server error") with
  // no way to correlate the client-reported failure to a stack. captureException
  // returns the Sentry event id; echoing it as `errorId` lets a client-reported
  // 500 body be joined against the Sentry event carrying the full stack.
  const errorId = Sentry.captureException(err, {
    tags: { component: "worker-error-handler" },
    extra: { url: ctx.req.url, method: ctx.req.method },
  });

  // Never leak error messages/stacks to clients in production. Detect prod from
  // the worker's ENVIRONMENT var (NODE_ENV is unset on Workers); fail closed.
  const isProd = isProductionEnv(ctx.env as { ENVIRONMENT?: string; NODE_ENV?: string });
  const isDev = !isProd;

  // 2026-10-06 (UAT synthesis RCA): an uncaught exception here bypasses the
  // cors() middleware's response decoration, so the 500 shipped with NO
  // access-control-allow-origin — the browser turned it into an opaque
  // "Failed to fetch" instead of the JSON error payload. Echo the CORS
  // origin explicitly for trusted origins so fatal errors remain readable
  // by the frontend (null/unknown origins stay headerless, fail closed).
  const corsOrigin = resolveCorsOrigin(ctx.req.header("Origin"), isProd);

  const response = ctx.json(
    {
      error: "Internal server error",
      errorId,
      ...(isDev && { message: errorMessage, stack: errorStack }),
    },
    500,
  );
  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
  }
  return response;
};
