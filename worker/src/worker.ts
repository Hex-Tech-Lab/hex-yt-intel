import { Hono } from "hono";
import { cors } from "hono/cors";
import { sentry } from "@sentry/hono/cloudflare";
import { optionalAuthMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { resolveCorsOrigin } from "./middleware/cors";
import health from "./routes/health";
import metadata from "./routes/metadata";
import transcript from "./routes/transcript";
import analysis from "./routes/analysis";
import chat from "./routes/chat";

type Env = {
  YOUTUBE_API_KEY: string;
  CLOUDFLARE_SECRET_TOKEN: string;
  RESIDENTIAL_PROXY_URL?: string;
  OPENROUTER_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  STREAM_HMAC_SECRET: string;
  APP_URL?: string;
  SENTRY_DSN?: string;
  ALLOWED_APP_ORIGINS?: string;
  NODE_ENV?: string;
  DEV_HMAC_SECRET?: string;
  DECODO_API_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", sentry(app, (env) => ({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})));

app.use("*", cors({
  origin: resolveCorsOrigin,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

app.use("*", optionalAuthMiddleware);

app.onError(errorHandler);

app.route("/", health);
app.route("/", metadata);
app.route("/", transcript);
app.route("/", analysis);
app.route("/", chat);

export default app;
