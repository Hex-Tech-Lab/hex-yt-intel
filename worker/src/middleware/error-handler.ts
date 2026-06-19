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

  return c.json(
    {
      error: "Internal server error",
      message: errorMessage,
      ...(typeof process !== "undefined" && process.env.NODE_ENV !== "production" && { stack: errorStack }),
    },
    500,
  );
};
