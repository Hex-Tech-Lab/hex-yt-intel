import { Hono } from "hono";
import * as Sentry from "@sentry/cloudflare";
import type { Context } from "hono";
import { isProductionEnv } from "../env-utils";
import { UpstashCacheAdapter } from "../services/UpstashCacheAdapter";
import { MetadataScraper } from "../services/MetadataScraper";
import { fetchChannelMetaCached, CHANNEL_META_CONFIG_FALLBACK, type AnalysisEnv } from "./analysis";

/**
 * Standalone channelMeta backfill: Vercel->Worker fetch endpoint for
 * `aux-remediation.ts` (web/lib/services/aux-remediation.ts).
 *
 * channelMeta is normally only ever fetched as a side effect deep inside
 * `/analyze-llm-stream` (fetchChannelMetaCached, analysis.ts), gated behind
 * a full LLM generation call whose S2S persist only fires when the
 * generation actually produced content (`hasContent` in atomicPersist).
 * That makes it unusable for backfilling a row whose 11 dimensions are
 * already complete -- there is nothing left to generate, so that persist
 * path would never fire. This route extracts the SAME fetch function (YouTube
 * Data API + Decodo scrape, no LLM involved, so no ADR-019 budget gating
 * applies) so it can be called on its own, synchronously, and its result
 * merged directly into `analysis_payload` by the caller.
 *
 * Mirrors comments.ts's HMAC verification exactly (same shared secret, same
 * timing-safe compare, same purpose-tagged message shape) -- see
 * web/lib/stream-token.ts#signChannelMetaToken for the matching signer.
 */

type ChannelMetaEnv = AnalysisEnv;

interface FetchRequest {
  videoId: string;
  analysisId: string;
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

export async function handleChannelMetaFetch(c: Context<{ Bindings: ChannelMetaEnv }>) {
  const req = await c.req.json<FetchRequest>().catch(() => null);
  if (!req || !req.videoId || !req.analysisId || !req.sig || !req.exp) {
    return c.json({ error: "Malformed request" }, 400);
  }

  const secret = c.env.STREAM_HMAC_SECRET;
  if (!secret) {
    // skipcq: JS-0827
    console.error("[channel-meta] Server misconfigured: missing signing key");
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
    const msg = `channel-meta:${req.analysisId}:${req.videoId}:${req.exp}`;
    const expected = await hmacHex(s, msg);
    if (timingSafeEqualHex(expected, req.sig)) {
      isTokenValid = true;
      break;
    }
  }

  if (!isTokenValid) {
    // skipcq: JS-0827
    console.warn("[channel-meta] Invalid fetch token", { analysisId: req.analysisId });
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;
  const cache = upstashUrl && upstashToken ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken }) : undefined;

  try {
    // Resolve channelId from the video itself rather than trusting a
    // persisted value -- a legacy row being backfilled may never have
    // stored channelId in analysis_payload.videoMetadata at all (its exact
    // key set has drifted over time, see aux-remediation.ts's own note on
    // this), and re-deriving it from the video ID (which every analysis
    // row always has) is one more cheap, no-LLM YouTube API call.
    const videoMeta = c.env.YOUTUBE_API_KEY
      ? await new MetadataScraper(c.env.YOUTUBE_API_KEY, c.env.RESIDENTIAL_PROXY_URL).fetch(req.videoId).catch(() => null)
      : null;
    if (!videoMeta?.channelId) {
      return c.json({ error: "Could not resolve channelId for video" }, 404);
    }
    const channelMeta = await fetchChannelMetaCached(videoMeta.channelId, c.env, cache, CHANNEL_META_CONFIG_FALLBACK);
    return c.json({ channelMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // skipcq: JS-0827
    console.error("[channel-meta] fetch failed:", message);
    Sentry.captureException(err, { tags: { operation: "channel-meta-fetch" }, extra: { analysisId: req.analysisId, videoId: req.videoId } });
    return c.json({ error: "Fetch failed" }, 502);
  }
}

const channelMeta = new Hono();

channelMeta.post("/channel-meta/fetch", handleChannelMetaFetch);

export default channelMeta;
