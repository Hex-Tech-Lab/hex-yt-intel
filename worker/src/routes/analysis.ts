import { Hono } from "hono";
import { TranscriptExtractor } from "../services/TranscriptExtractor";
import type { TranscriptSegment } from "../ports/TranscriptProviderPort";
import { ReasoningEngine } from "../services/ReasoningEngine";
import { PromptBuilder } from "../services/PromptBuilder";
import { LLMCascade } from "../services/LLMCascade";
import { ValidationService } from "../services/ValidationService";
import { UpstashCacheAdapter } from "../services/UpstashCacheAdapter";
import { PersistService } from "../services/PersistService";
import { createAtomicPersist } from "../services/atomic-persist";
import { hmacHex, secretFingerprint } from "../crypto";
import { isProductionEnv } from "../env-utils";
import { isValidAppUrl } from "../middleware/cors";
import type { ReasoningEnginePort, StreamStatusEvent } from "../ports/ReasoningEnginePort";

declare const process: any;



/** Compare two hex strings for equality using constant-time comparison to prevent timing attacks. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type AnalysisEnv = {
  YOUTUBE_API_KEY: string;
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
  RESIDENTIAL_PROXY_URL?: string;
  DECODO_API_KEY?: string;
};

if (typeof process !== 'undefined' && process.env?.RESIDENTIAL_PROXY_URL === undefined) {
  console.debug('[analyze-llm-stream] RESIDENTIAL_PROXY_URL not configured, YouTube fallback unavailable', { config: 'proxy-disabled' });
}

interface AnalysisRequest {
  videoId: string;
  transcript: string;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
  persona: string;
  timezone: string;
  systemPrompt?: string;
}

interface StreamRequest {
  videoId: string;
  analysisId: string;
  transcript: string;
  segments?: Array<{ start: number; duration: number; text: string }>;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string | number;
    likeCount: string | number;
    commentCount: string | number;
  };
  persona: string;
  timezone: string;
  models?: string[];
  sig: string;
  exp: number;
  appUrl?: string;
  dimensions?: number[];
  chunkIndex?: number;
  totalChunks?: number;
}

interface TokenVerificationResult {
  isValid: boolean;
  secret: string;
  msg: string;
}

/** Verify HMAC signature of stream request token using stored secret. Returns validation result and secret. */
async function verifyStreamToken(
  videoId: string,
  analysisId: string,
  exp: number,
  sig: string,
  models: string[] | undefined,
  env: AnalysisEnv,
): Promise<TokenVerificationResult> {
  const secret = env.STREAM_HMAC_SECRET;

  if (Date.now() > exp) {
    return { isValid: false, secret: "", msg: "" };
  }

  const activeSecret = secret;
  const secretsToTry = [secret];

  // DEV_HMAC_SECRET is a local/preview convenience only — never accept it in
  // production (matches the chat verifier; prevents a non-prod secret from
  // authenticating against the prod worker).
  if (!isProductionEnv(env) && env.DEV_HMAC_SECRET) {
    secretsToTry.push(env.DEV_HMAC_SECRET);
  }

  for (const s of secretsToTry) {
    if (!s) continue;
    const modelStr = [...(models ?? [])].sort().join(",");
    const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
    const expected = await hmacHex(s, msg);

    if (timingSafeEqualHex(expected, sig)) {
      return { isValid: true, secret: s, msg: "" };
    }
  }

  const modelStr = [...(models ?? [])].sort().join(",");
  const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
  return { isValid: false, secret: activeSecret, msg };
}

interface ResolvedTranscript {
  transcript: string | undefined;
  segments?: TranscriptSegment[];
  channelMeta?: Record<string, unknown> | null;
}

/**
 * Fetch video transcript if missing or invalid; attempts cache then multiple sources.
 *
 * RCA (2026-07-22): this used to return `string | undefined` (flat text only), while
 * `TranscriptExtractor.fetch()` already produces timed `segments` internally
 * (`fetchFromPageHTML`/`fetchWithDecodo`). Those segments were discarded here, so the
 * persist call downstream fell back to `req.segments` — the ORIGINAL request's segments
 * field, which the browser never populates (Vercel deliberately blanks the transcript
 * before minting the stream token; the real transcript is only ever fetched here,
 * worker-side). Net effect: the `transcripts` table almost never got a row, so chat
 * grounding correctly-but-confusingly reported "no transcript" on analyses that DID
 * have one. Returning segments alongside the flat text closes that gap for the fresh-
 * fetch path; the cache round-trip below now also carries segments so repeat analyses
 * of the same video (cache HIT) don't regress back to segment-less.
 */
async function fetchTranscriptIfMissing(
  transcript: string | undefined,
  videoId: string,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY">,
  channelId?: string,
  cache?: UpstashCacheAdapter,
): Promise<ResolvedTranscript> {
  const isPlaceholder = transcript?.includes("Transcript unavailable for this video");
  let segments: TranscriptSegment[] | undefined;

  // Fetched unconditionally (independent of transcript cache/fetch branches below) --
  // previously this only ran inside the transcript-missing branch, so any analysis
  // whose transcript already existed (the common case) never got channel metadata
  // at all, on top of it being fetched then immediately discarded after a log line.
  const channelMetaPromise: Promise<Record<string, unknown> | null> = channelId
    ? new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY).fetchChannelMetadata(channelId).catch(() => null)
    : Promise.resolve(null);

  if (!transcript || transcript.trim().length === 0 || isPlaceholder) {
    console.info(`[analyze-llm-stream] Transcript missing or placeholder, attempting fetch for ${videoId}`);

    // L1 Redis transcript cache: 72h TTL (3-day compliance window)
    const CACHE_TTL = 259200;
    const cacheKey = `transcript:${videoId}`;

    if (cache) {
      try {
        const cached = await cache.get(cacheKey);
        if (cached && cached.trim().length > 0 && !cached.includes("Transcript unavailable")) {
          console.info(`[analyze-llm-stream] Transcript cache HIT for ${videoId}`);
          const channelMeta = await channelMetaPromise;
          // Cache values written pre-fix are plain transcript strings, not JSON —
          // parse defensively and fall back to flat text (no segments) for those.
          try {
            const parsed = JSON.parse(cached) as ResolvedTranscript;
            if (parsed && typeof parsed.transcript === 'string') {
              return { ...parsed, channelMeta };
            }
          } catch (e) {
            console.debug(`[analyze-llm-stream] Cache entry for ${videoId} is not JSON — legacy plain-string entry, falling back to flat text`, e);
          }
          return { transcript: cached, channelMeta };
        }
      } catch {
        console.warn(`[analyze-llm-stream] Transcript cache GET failed for ${videoId}, proceeding with fetch`);
      }
    }

    try {
      const extractor = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY);
      const result = await extractor.fetch(videoId);
      if (result.transcript && result.transcript.trim().length > 0 && !result.transcript.includes("Transcript unavailable")) {
        transcript = result.transcript;
        segments = result.segments;
        console.info(`[analyze-llm-stream] Fetch successful for ${videoId}`, { segmentCount: segments?.length ?? 0 });

        // Cache the successful transcript fetch, segments included so a cache HIT
        // on a repeat analysis still yields timed segments (see RCA above).
        if (cache) {
          const cachePayload: ResolvedTranscript = { transcript, segments };
          cache.set(cacheKey, JSON.stringify(cachePayload), CACHE_TTL).catch(() => {
            console.warn(`[analyze-llm-stream] Transcript cache SET failed for ${videoId}`);
          });
        }
      }
    } catch (e) {
      console.error(`[analyze-llm-stream] Fetch failed for ${videoId}: ${e instanceof Error ? e.message : "Unknown"}`);
      if (!transcript) {
        transcript = "[Transcript unavailable for this video - content ingestion failed across all available sources]";
      }
    }
  }

  const channelMeta = await channelMetaPromise;
  if (channelMeta) {
    console.info(`[analyze-llm-stream] Channel metadata enriched for ${channelId}`);
  }
  return { transcript, segments, channelMeta };
}

/** Build SSE streaming response with real-time analysis deltas, status updates, and atomic persist coordination. */
function buildStreamResponse(
  engine: ReasoningEnginePort,
  req: StreamRequest,
  signingKey: string,
  appUrl: string | undefined,
  httpConnSignal: AbortSignal | undefined,
  persistController: AbortController,
  waitUntil: (p: Promise<unknown>) => void,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY">,
  cache?: UpstashCacheAdapter,
): Response {
  const encoder = new TextEncoder();
  let finalText = "";
  let modelUsed = "";
  let settled = false;
  // Populated once fetchTranscriptIfMissing resolves inside the stream's start()
  // handler below; defaults to req.segments (almost always empty from the browser)
  // so an interrupted/timeout persist firing before resolution still has a value.
  let resolvedSegments: TranscriptSegment[] | undefined = req.segments;
  // Flat transcript text, kept alongside segments so the persist call can write
  // a `transcripts` row even when the video has a transcript but no timed
  // segments (e.g. it arrived pre-fetched from initial ingestion and
  // fetchTranscriptIfMissing's short-circuit never re-fetches with timing —
  // see RCA on fetchTranscriptIfMissing above). Chat grounding only needs the
  // text; segments are solely for timestamp-linked playback.
  let resolvedTranscriptText: string | undefined = req.transcript;
  // Channel-level metadata (subscriber count, channel description, etc.) --
  // previously fetched then discarded; now threaded through to persist so
  // chat grounding has more than just the video's own metadata to draw on.
  let resolvedChannelMeta: Record<string, unknown> | null = null;

  const persistService = new PersistService();

  // Monitor client disconnect to settle early without aborting persist
  if (httpConnSignal && !httpConnSignal.aborted) {
    httpConnSignal.addEventListener(
      'abort',
      () => {
        if (!settled) {
          settled = true;
          console.debug('[analyze-llm-stream] Client disconnected, allowing persist to complete', { event: 'http-abort' });
        }
      },
      { once: true },
    );
  }

  const atomicPersist = createAtomicPersist({
    hasContent: () => finalText.length > 0,
    persist: (status) => {
      const url = appUrl || "https://yt-intel.getmytestdrive.com";
      const persistParams = {
        analysisId: req.analysisId,
        videoId: req.videoId,
        finalText,
        modelUsed,
        activeSecret: signingKey,
        appUrl: url,
        validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
        chunkIndex: req.chunkIndex,
        totalChunks: req.totalChunks,
        segments: resolvedSegments,
        transcript: resolvedTranscriptText,
        channelMeta: resolvedChannelMeta,
      };

      // RCA (2026-07-22): this used to race EVERY persist call (including successful
      // 'completed' ones) against a 15s timeout that, on firing, sent a SECOND persist
      // with status forced to 'interrupted' -- silently downgrading a genuinely
      // successful generation to 'interrupted' whenever the network round-trip to
      // Vercel merely ran long (not a generation timeout, a persist-write timeout).
      // Vercel's chunk-completeness check (`FINAL_CHUNK_STATUS = 'completed'`) then
      // permanently excludes that dimension bundle, freezing billing_status at
      // 'failed' even though the content was real and complete (A6). PersistService
      // already retries the actual HTTP call internally (2 attempts, 10s AbortSignal
      // timeout each) -- this outer race added no protection for the success path,
      // only harm. Now only applied when we're already persisting as 'interrupted'
      // (the abort/disconnect path), where a bounded best-effort attempt before
      // giving up is the correct behavior.
      if (status !== 'interrupted') {
        return persistService.persist({ ...persistParams, status });
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const persistPromise = persistService.persist({ ...persistParams, status }).then((result) => {
        clearTimeout(timeoutId ?? null);
        return result;
      });

      const timeoutPromise = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          // Only reachable when persisting an already-'interrupted' outcome (the
          // client's SSE stream is done receiving deltas by this point, regardless
          // of how this persist call resolves) -- `settled` guards this module's own
          // persist bookkeeping, not the client stream, so no send({type:'error'})
          // belongs here.
          settled = true;
          resolve(persistService.persist({ ...persistParams, status: 'interrupted' }));
        }, 15000);
      });

      return Promise.race([persistPromise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    },
    signal: persistController.signal,
    waitUntil,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (err: any) {
          console.debug('[analyze-llm-stream] Client connection closed during enqueue:', err instanceof Error ? err.message : String(err));
        }
      };

      // Send immediate status frame, then fetch transcript asynchronously
      send({ type: "status", stage: "extracting", videoId: req.videoId });

      const [fetchResult] = await Promise.allSettled([fetchTranscriptIfMissing(
        req.transcript,
        req.videoId,
        { RESIDENTIAL_PROXY_URL: env.RESIDENTIAL_PROXY_URL, DECODO_API_KEY: env.DECODO_API_KEY },
        (req.metadata as { channelId?: string }).channelId,
        cache,
      )]);

      const resolvedTranscript = fetchResult.status === 'fulfilled' ? fetchResult.value.transcript : undefined;
      // Only overwrite the req.segments default when the fetch actually produced
      // timed segments — an interrupted fetch (rejected settle) must not wipe out
      // whatever the request already carried.
      if (fetchResult.status === 'fulfilled' && fetchResult.value.segments) {
        resolvedSegments = fetchResult.value.segments;
      }
      if (resolvedTranscript) {
        resolvedTranscriptText = resolvedTranscript;
      }
      if (fetchResult.status === 'fulfilled' && fetchResult.value.channelMeta) {
        resolvedChannelMeta = fetchResult.value.channelMeta;
      }

      if (!resolvedTranscript || !resolvedTranscript.trim() || resolvedTranscript.includes("Transcript unavailable") || resolvedTranscript.includes("content ingestion failed")) {
        send({ type: "error", error: "No transcript available", code: "ERR_NO_TRANSCRIPT" });
        controller.close();
        return;
      }

      try {
        send({ type: "status", stage: "starting", videoId: req.videoId });

        const result = await engine.executeAndStream(
          {
            metadata: req.metadata,
            transcript: resolvedTranscript,
            persona: req.persona,
            timezone: req.timezone,
            dimensions: req.dimensions,
          },
          {
            onDelta: (delta: string) => {
              finalText += delta;
              send({ type: "delta", content: delta });
            },
            onFragment: (fragment: any) => send(fragment as unknown as Record<string, unknown>),
            onStatus: (statusEvent: StreamStatusEvent) => {
              if (statusEvent.stage === "model" && statusEvent.model) {
                modelUsed = statusEvent.model;
              }
              send({ type: "status", ...statusEvent });
            },
          },
          httpConnSignal,
        );

        if (!result.produced && !result.finalText) {
          send({ type: "error", error: "All models in cascade failed to produce output" });
          controller.close();
          return;
        }

        send({ type: "complete", model: result.modelUsed, valid: result.valid, videoId: req.videoId, analysisId: req.analysisId });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "stream failed" });
      } finally {
        if (!settled) {
          atomicPersist.flush();
        }
        persistController.abort();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

const analysis = new Hono<{ Bindings: AnalysisEnv }>();

analysis.post("/analyze-llm", async (c) => {
  const request = (await c.req.json()) as AnalysisRequest;

  if (!request.videoId || !request.transcript || !request.metadata) {
    return c.json({ success: false, error: "Missing required fields" }, 400);
  }

  try {
    const apiKey = c.env.OPENROUTER_API_KEY;
    const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;

    if (!apiKey) {
      console.error("[analyze-llm] Server misconfigured: Missing router credentials");
      return c.json({ success: false, error: "Server misconfigured" }, 500);
    }

    if (!upstashUrl || !upstashToken) {
      console.warn("[analyze-llm] Upstash not configured, proceeding without caching");
    }

    const cache =
      upstashUrl && upstashToken
        ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken })
        : undefined;
    const engine: ReasoningEnginePort = new ReasoningEngine(new PromptBuilder(), new LLMCascade(apiKey), new ValidationService(), cache);

    const result = await engine.execute({
      metadata: request.metadata,
      transcript: request.transcript,
      persona: request.persona,
      timezone: request.timezone,
      videoId: request.videoId,
      systemPrompt: request.systemPrompt,
    });

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 502);
    }

    return c.json({
      success: true,
      analysis: result.analysis,
      model: result.model,
      cached: result.cached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[analyze-llm] Error:", message);

    return c.json(
      {
        success: false,
        error: message,
      },
      500,
    );
  }
});

analysis.post("/analyze-llm-stream", async (c) => {
  const req = (await c.req.json()) as StreamRequest;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!req.videoId || !req.analysisId || !req.metadata || !req.sig || !req.exp) {
    const missing = [];
    if (!req.videoId) missing.push("videoId");
    if (!req.analysisId) missing.push("analysisId");
    if (!req.metadata) missing.push("metadata");
    if (!req.sig) missing.push("sig");
    if (!req.exp) missing.push("exp");
    return c.json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  if (!isValidAppUrl(req.appUrl, c.env.APP_URL, c.env.ALLOWED_APP_ORIGINS, isProductionEnv(c.env))) {
    console.warn("[analyze-llm-stream] Blocked untrusted appUrl callback redirect:", req.appUrl);
    return c.json({ error: "Invalid appUrl callback destination" }, 400);
  }

  if (!c.env.STREAM_HMAC_SECRET || !apiKey) {
    console.error("[analyze-llm-stream] Server misconfigured: missing signature key or router credentials");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const { isValid: isTokenValid, secret: signingKey, msg } = await verifyStreamToken(req.videoId, req.analysisId, req.exp, req.sig, req.models, c.env);

  if (!isTokenValid) {
    // `msg` is "" only on the expiry early-return; otherwise it's the reconstructed
    // message from the signature-mismatch path.
    const reason = msg === "" ? "expired" : "invalid_signature";
    // Full diagnostics go to SERVER logs only — never the client response, which
    // previously echoed the internal msg (analysisId/models/exp) + sig to any
    // caller (the prod worker leaked this because NODE_ENV is unset, so the old
    // NODE_ENV !== "production" guard was always true). Secret fingerprints let
    // ops compare the Worker's secrets against the Vercel signer's without
    // logging the secrets themselves.
    const keyFpPrimary = await secretFingerprint(c.env.STREAM_HMAC_SECRET);
    const keyFpFallback = await secretFingerprint(c.env.DEV_HMAC_SECRET);
    console.warn("[analyze-llm-stream] stream signature rejected", {
      reason,
      videoId: req.videoId,
      analysisId: req.analysisId,
      keyFpPrimary,
      keyFpFallback,
    });
    return c.json({ error: "Invalid token", reason }, 401);
  }

  const engine: ReasoningEnginePort = new ReasoningEngine(new PromptBuilder(), new LLMCascade(apiKey, req.models), new ValidationService(), undefined);

  const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;
  const cache =
    upstashUrl && upstashToken
      ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken })
      : undefined;

  const persistController = new AbortController();
  const httpConnSignal = c.req.raw['signal'];

  return buildStreamResponse(engine, req, signingKey, req.appUrl || c.env.APP_URL, httpConnSignal, persistController, (p) => c.executionCtx.waitUntil(p), c.env, cache);
});

export default analysis;
