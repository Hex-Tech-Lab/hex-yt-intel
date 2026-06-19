import type { ErrorHandler } from "hono";

export const errorHandler: ErrorHandler = (err, c) => {
  const errorMessage = err instanceof Error ? err.message : "Unknown error";
  const errorStack = err instanceof Error ? err.stack : "";

  console.error("[Worker] Uncaught error:", {
    message: errorMessage,
    stack: errorStack,
    url: c.req.url,
    method: c.req.method,
  });

  const isDev = typeof process !== "undefined" && process.env.NODE_ENV !== "production";

  return c.json(
    {
      error: "Internal server error",
      ...(isDev && { message: errorMessage, stack: errorStack }),
    },
    500,
  );
};
