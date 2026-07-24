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
import comments from "./routes/comments";
import { handleCommentsTier3Message } from "./queue-consumers/comments-tier3";
import type { CommentsTier3QueueMessage } from "./routes/comments";

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
  ENVIRONMENT?: string;
  DEV_HMAC_SECRET?: string;
  DECODO_API_KEY?: string;
  COMMENTS_TIER3_QUEUE: Queue<CommentsTier3QueueMessage>;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", sentry(app, (env: Env) => ({
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
app.route("/", comments);

export default {
  fetch: app.fetch,
  // Cloudflare Queues consumer entrypoint (Tier 3 uncapped comment fetch,
  // see queue-consumers/comments-tier3.ts). max_batch_size=1 in wrangler.toml
  // -- each Tier 3 job is a long paginated fetch, kept isolated per-invocation
  // rather than batched with others so one failing job can't stall siblings.
  async queue(batch: MessageBatch<CommentsTier3QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleCommentsTier3Message(message.body, env);
        message.ack();
      } catch (err) {
        // skipcq: JS-0827
        console.error("[worker] queue message processing threw:", err instanceof Error ? err.message : String(err));
        message.retry();
      }
    }
  },
};
