import { Hono } from "hono";
import { TranscriptExtractor } from "../services/TranscriptExtractor";
import { ReasoningEngine } from "../services/ReasoningEngine";
import { PromptBuilder } from "../services/PromptBuilder";
import { LLMCascade } from "../services/LLMCascade";
import { ValidationService } from "../services/ValidationService";
import { UpstashCacheAdapter } from "../services/UpstashCacheAdapter";
import { PersistService } from "../services/PersistService";
import { createAtomicPersist } from "../services/atomic-persist";
import { hmacHex } from "../crypto";
import { isValidAppUrl } from "../middleware/cors";
import type { ReasoningEnginePort } from "../ports/ReasoningEnginePort";

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

  if (env.DEV_HMAC_SECRET) {
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

/** Fetch video transcript if missing or invalid; attempts multiple sources before returning fallback message. */
async function fetchTranscriptIfMissing(
  transcript: string | undefined,
  videoId: string,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY">,
  channelId?: string,
): Promise<string | undefined> {
  const isPlaceholder = transcript?.includes("Transcript unavailable for this video");

  if (!transcript || transcript.trim().length === 0 || isPlaceholder) {
    console.info(`[analyze-llm-stream] Transcript missing or placeholder, attempting fetch for ${videoId}`);
    try {
      const extractor = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY);
      const [result, channelMeta] = await Promise.all([
        extractor.fetch(videoId),
        channelId ? extractor.fetchChannelMetadata(channelId).catch(() => null) : Promise.resolve(null),
      ]);
      if (result.transcript && result.transcript.trim().length > 0 && !result.transcript.includes("Transcript unavailable")) {
        transcript = result.transcript;
        console.info(`[analyze-llm-stream] Fetch successful for ${videoId}`);
      }
      if (channelMeta) {
        console.info(`[analyze-llm-stream] Channel metadata enriched for ${channelId}`);
      }
    } catch (e) {
      console.error(`[analyze-llm-stream] Fetch failed for ${videoId}: ${e instanceof Error ? e.message : "Unknown"}`);
      if (!transcript) {
        transcript = "[Transcript unavailable for this video - content ingestion failed across all available sources]";
      }
    } finally {
      // Clean up any proxy connections if needed
    }
  }

  return transcript;
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
): Response {
  const encoder = new TextEncoder();
  let finalText = "";
  let modelUsed = "";
  let settled = false;

  const persistService = new PersistService();

  // Monitor client disconnect to settle early without aborting persist
  if (httpConnSignal && !httpConnSignal.aborted) {
    httpConnSignal.addEventListener(
      'abort',
      () => {
        if (!settled) {
          settled = true;
          console.debug('[analyze-llm-stream] Client disconnected, allowing persist to complete');
        }
      },
      { once: true },
    );
  }

  const atomicPersist = createAtomicPersist({
    hasContent: () => finalText.length > 0,
    persist: (status) => {
      const url = appUrl || "https://yt-intel.getmytestdrive.com";
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const persistPromise = persistService.persist({
        analysisId: req.analysisId,
        videoId: req.videoId,
        finalText,
        modelUsed,
        status,
        activeSecret: signingKey,
        appUrl: url,
        validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
        chunkIndex: req.chunkIndex,
        totalChunks: req.totalChunks,
      }).then((result) => {
        clearTimeout(timeoutId);
        return result;
      });

      const timeoutPromise = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          settled = true;
          // settleAnalysis: Handle timeout by persisting with interrupted status
          resolve(persistService.persist({
            analysisId: req.analysisId,
            videoId: req.videoId,
            finalText,
            modelUsed,
            status: 'interrupted',
            activeSecret: signingKey,
            appUrl: url,
            validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
            chunkIndex: req.chunkIndex,
            totalChunks: req.totalChunks,
          }));
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
      )]);

      const resolvedTranscript = fetchResult.status === 'fulfilled' ? fetchResult.value : undefined;

      if (!resolvedTranscript || !resolvedTranscript.trim() || resolvedTranscript.includes("Transcript unavailable") || resolvedTranscript.includes("content ingestion failed")) {
        send({ type: "error", error: "No transcript available" });
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
            onDelta: (delta) => {
              finalText += delta;
              send({ type: "delta", content: delta });
            },
            onFragment: (fragment) => send(fragment as unknown as Record<string, unknown>),
            onStatus: (statusEvent) => {
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

  if (!isValidAppUrl(req.appUrl, c.env.APP_URL, c.env.ALLOWED_APP_ORIGINS, c.env.NODE_ENV === "production")) {
    console.warn("[analyze-llm-stream] Blocked untrusted appUrl callback redirect:", req.appUrl);
    return c.json({ error: "Invalid appUrl callback destination" }, 400);
  }

  if (!c.env.STREAM_HMAC_SECRET || !apiKey) {
    console.error("[analyze-llm-stream] Server misconfigured: missing signature key or router credentials");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const { isValid: isTokenValid, secret: signingKey, msg } = await verifyStreamToken(req.videoId, req.analysisId, req.exp, req.sig, req.models, c.env);

  if (!isTokenValid) {
    const isPreview = c.env.NODE_ENV !== "production";
    if (isPreview) {
      const isFallbackUsed = signingKey === "dev-hmac-secret-123";
      console.warn("[analyze-llm-stream] HMAC Mismatch Diagnostic:", {
        providedSig: req.sig,
        message: msg,
        isFallbackUsed,
      });
      return c.json(
        {
          error: "Invalid token",
          debug: {
            msg,
            sig: req.sig,
            isFallbackUsed,
          },
        },
        401,
      );
    }
    return c.json({ error: "Invalid token" }, 401);
  }

  const engine: ReasoningEnginePort = new ReasoningEngine(new PromptBuilder(), new LLMCascade(apiKey, req.models), new ValidationService(), undefined);

  const persistController = new AbortController();
  const httpConnSignal = c.req.raw['signal'];

  return buildStreamResponse(engine, req, signingKey, req.appUrl || c.env.APP_URL, httpConnSignal, persistController, (p) => c.executionCtx.waitUntil(p), c.env);
});

export default analysis;
