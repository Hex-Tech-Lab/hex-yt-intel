import type { MiddlewareHandler } from "hono";

export const optionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = c.env.CLOUDFLARE_SECRET_TOKEN;

  if (authHeader?.startsWith("Bearer ")) {
    const providedToken = authHeader.slice(7);
    if (token && providedToken === token) {
      c.set("authenticated", true);
      c.set("tokenVerified", true);
    }
  }

  await next();
};
