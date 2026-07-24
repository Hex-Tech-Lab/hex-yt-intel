import { Hono } from "hono";
import * as Sentry from "@sentry/cloudflare";
import { isProductionEnv } from "../env-utils";
import type { Context } from "hono";

/**
 * Tier 3 (uncapped) comment fetch: Vercel->Worker enqueue endpoint.
 *
 * Mirrors chat-stream.ts's HMAC verification exactly (same shared secret,
 * same timing-safe compare) -- see web/lib/stream-token.ts#signCommentsTier3Token
 * for the matching signer. The Worker enqueues to Cloudflare Queues rather
 * than doing the paginated fetch synchronously here: a 30K-comment run needs
 * 300+ sequential YouTube API pages (pagination is inherently sequential,
 * verified against the real API mechanics -- see
 * docs/specs/COMMENTS_SAMPLING_ENGINE_PLAN_2026-07-24.md), which can run to
 * 45-90+ seconds and cannot complete inside one HTTP request/response cycle.
 */

type CommentsEnv = {
  STREAM_HMAC_SECRET: string;
  DEV_HMAC_SECRET?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  COMMENTS_TIER3_QUEUE: Queue<CommentsTier3QueueMessage>;
};

export interface CommentsTier3QueueMessage {
  sampleRunId: string;
  videoId: string;
  userId: string;
  totalCommentCount: number;
  appUrl: string;
}

interface EnqueueRequest {
  sampleRunId: string;
  videoId: string;
  userId: string;
  totalCommentCount: number;
  appUrl: string;
  sig: string;
  exp: number;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleCommentsTier3Enqueue(c: Context<{ Bindings: CommentsEnv }>) {
  const req = await c.req.json<EnqueueRequest>().catch(() => null);
  if (!req || !req.sampleRunId || !req.videoId || !req.userId || !req.sig || !req.exp) {
    return c.json({ error: "Malformed request" }, 400);
  }

  const secret = c.env.STREAM_HMAC_SECRET;
  if (!secret) {
    // skipcq: JS-0827
    console.error("[comments-tier3] Server misconfigured: missing signing key");
    return c.json({ error: "Server misconfigured" }, 500);
  }
  if (Date.now() > req.exp) {
    return c.json({ error: "Token expired" }, 401);
  }

  const secretsToTry = [secret];
  if (!isProductionEnv(c.env) && c.env.DEV_HMAC_SECRET) {
    secretsToTry.push(c.env.DEV_HMAC_SECRET);
  }

  let isTokenValid = false;
  for (const s of secretsToTry) {
    if (!s) continue;
    const msg = `comments-tier3:${req.sampleRunId}:${req.userId}:${req.exp}`;
    const expected = await hmacHex(s, msg);
    if (timingSafeEqualHex(expected, req.sig)) {
      isTokenValid = true;
      break;
    }
  }

  if (!isTokenValid) {
    // skipcq: JS-0827
    console.warn("[comments-tier3] Invalid enqueue token", { sampleRunId: req.sampleRunId });
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  if (!c.env.COMMENTS_TIER3_QUEUE) {
    // skipcq: JS-0827
    console.error("[comments-tier3] COMMENTS_TIER3_QUEUE binding missing");
    Sentry.captureMessage("comments-tier3 enqueue: queue binding missing", { level: "error" });
    return c.json({ error: "Queue not configured" }, 500);
  }

  try {
    await c.env.COMMENTS_TIER3_QUEUE.send({
      sampleRunId: req.sampleRunId,
      videoId: req.videoId,
      userId: req.userId,
      totalCommentCount: req.totalCommentCount,
      appUrl: req.appUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // skipcq: JS-0827
    console.error("[comments-tier3] Queue send failed:", message);
    Sentry.captureException(err, { tags: { operation: "comments-tier3-enqueue" }, extra: { sampleRunId: req.sampleRunId } });
    return c.json({ error: "Failed to enqueue" }, 502);
  }

  return c.json({ status: "queued", sampleRunId: req.sampleRunId });
}

const comments = new Hono();

comments.post("/comments/tier3/enqueue", handleCommentsTier3Enqueue);

export default comments;
