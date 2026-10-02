import { Hono } from "hono";

type ProviderEnv = {
  TRANSCRIPTAPI_API_KEY?: string;
  APIFY_TOKEN?: string;
  DECODO_API_KEY?: string;
  SUPADATA_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
};

const health = new Hono<{ Bindings: ProviderEnv }>();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "YouTube Intelligence Worker API",
    endpoint: "/fetch-metadata?video_id=VIDEO_ID",
  });
});

/** True only for a bound, non-blank secret. A secret can be bound with an empty value. */
export const isConfigured = (value: string | undefined): boolean => typeof value === "string" && value.trim().length > 0;

/**
 * Which upstream credentials are usable — booleans only, never values.
 * `wrangler secret list` only proves a NAME is bound: TRANSCRIPTAPI_API_KEY
 * sat bound-but-empty from 2026-09-26 to 2026-10-02 (piped from a Vercel
 * "sensitive" var that `vercel env pull` returns empty), silently sending
 * every fresh transcript to Apify (~9 s instead of ~0.4 s). The deploy
 * workflow gates on this endpoint; the management dashboard can read it too.
 */
health.get("/health/providers", (c) => {
  return c.json({
    transcriptapi: isConfigured(c.env.TRANSCRIPTAPI_API_KEY),
    apify: isConfigured(c.env.APIFY_TOKEN),
    decodo: isConfigured(c.env.DECODO_API_KEY),
    supadata: isConfigured(c.env.SUPADATA_API_KEY),
    youtube: isConfigured(c.env.YOUTUBE_API_KEY),
    openrouter: isConfigured(c.env.OPENROUTER_API_KEY),
  });
});

export default health;
