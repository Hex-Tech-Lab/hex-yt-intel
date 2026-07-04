import type { ErrorHandler } from "hono";
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

  // Never leak error messages/stacks to clients in production. Detect prod from
  // the worker's ENVIRONMENT var (NODE_ENV is unset on Workers); fail closed.
  const isDev = !isProductionEnv(c.env as { ENVIRONMENT?: string; NODE_ENV?: string });

  return c.json(
    {
      error: "Internal server error",
      ...(isDev && { message: errorMessage, stack: errorStack }),
    },
    500,
  );
};
