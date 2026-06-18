import { Hono } from "hono";
import { cors } from "hono/cors";
import { sentry } from "@sentry/hono/cloudflare";
// Ingestion + reasoning services. The ReasoningEngine bundles the UCIS prompt IP
// (getUCISPrompt) and dimension parser internally via esbuild, so neither ever
// reaches the browser. worker.ts is the orchestrator: it wires these services to
// the HTTP/SSE transport and owns auth, HMAC, and persistence.
import { TranscriptExtractor } from "./services/TranscriptExtractor";
import { MetadataScraper } from "./services/MetadataScraper";
import { ReasoningEngine } from "./services/ReasoningEngine";
import { handleChatStream } from "./chat-stream";
import { PromptBuilder } from "./services/PromptBuilder";
import { LLMCascade } from "./services/LLMCascade";
import { ValidationService } from "./services/ValidationService";
import { UpstashCacheAdapter } from "./services/UpstashCacheAdapter";
import { PersistService } from "./services/PersistService";
import { createAtomicPersist } from "./services/atomic-persist";
import { hmacHex } from "./crypto";
import type { ReasoningEnginePort } from "./ports/ReasoningEnginePort";

type Env = {
// ... (lines omitted for brevity, will be handled by the tool)
  YOUTUBE_API_KEY: string;
  CLOUDFLARE_SECRET_TOKEN: string;
  RESIDENTIAL_PROXY_URL?: string;
  OPENROUTER_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  // Shared HMAC secret with Vercel: gates direct browser->worker streaming (token
  // bound to videoId+analysisId+expiry) and signs the final markdown so Vercel can
  // persist it tamper-proof — the worker never holds the Supabase service key.
  STREAM_HMAC_SECRET: string;
  // Vercel app origin the worker calls server-to-server (in waitUntil) to persist.
  APP_URL?: string;
  SENTRY_DSN?: string;
  ALLOWED_APP_ORIGINS?: string;
  NODE_ENV?: string;
  DEV_HMAC_SECRET?: string;
  DECODO_API_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS to approved origins only
const allowedOrigins = [
  'https://hex-yt-intel.vercel.app',
  'https://yt-intel.getmytestdrive.com',
  'http://localhost:3000',
  'http://localhost:3005',
];

// Constant-time hex compare (avoids early-exit timing leaks).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isValidAppUrl(
  urlStr: string | undefined,
  envAppUrl: string | undefined,
  allowedOrigins?: string,
  isProd?: boolean
): boolean {
  if (!urlStr) return true;

  try {
    const parsedUrl = new URL(urlStr);
    const origin = parsedUrl.origin.toLowerCase();

    // 1. If it matches envAppUrl's origin, it's safe
    if (envAppUrl) {
      const parsedEnv = new URL(envAppUrl);
      if (origin === parsedEnv.origin.toLowerCase()) {
        return true;
      }
    }

    // 2. Check explicitly allowed origins from env
    if (allowedOrigins) {
      const list = allowedOrigins.split(",").map((o) => o.trim().toLowerCase());
      if (list.includes(origin)) {
        return true;
      }
    }

    // 3. For non-production/preview environments, OR if it's a vercel preview domain, OR it's the prod domain, allow
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!isProd || hostname.endsWith(".vercel.app") || hostname === "yt-intel.getmytestdrive.com") {
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".vercel.app") ||
        hostname === "yt-intel.getmytestdrive.com"
      ) {
        return true;
      }
    }
  } catch (e) {
    return false;
  }

  return false;
}

// Return the request origin (not a boolean) when allowlisted, so Hono emits a
// valid `Access-Control-Allow-Origin: <origin>` header. Returning a boolean made
// Hono serialize the header literally as "true", which browsers reject. Server-
// to-server calls (no Origin) skip CORS entirely and are unaffected.
const corsMiddleware = (origin: string | undefined): string | null => {
  if (!origin) return null;
  if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
    return origin;
  }
  // Allow dynamic Vercel preview deployment origins (e.g. hex-yt-intel-git-*.vercel.app)
  if (origin.startsWith('https://hex-yt-intel-') && origin.endsWith('.vercel.app')) {
    return origin;
  }
  return null;
};

app.use("*", sentry(app, (env) => ({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})));

app.use("*", cors({
  origin: corsMiddleware,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Shared authentication middleware for protected endpoints
const optionalAuthMiddleware = async (c: any, next: any) => {
  // Token validation is optional - endpoints work without auth for public metadata
  // but will enforce stricter rate limits if auth is not provided
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

// Apply optional auth middleware to all endpoints (for future rate limit scoping)
app.use("*", optionalAuthMiddleware);

// Global error handler for uncaught exceptions
app.onError((err, c) => {
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  const errorStack = err instanceof Error ? err.stack : '';

  console.error('[Worker] Uncaught error:', {
    message: errorMessage,
    stack: errorStack,
    url: c.req.url,
    method: c.req.method,
  });

  // Return 500 with error details (safe for debugging, no sensitive data)
  return c.json(
    {
      error: 'Internal server error',
      message: errorMessage,
      // Only include stack trace in development/staging (can be controlled via env flag)
      ...(typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && { stack: errorStack }),
    },
    500
  );
});

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "YouTube Intelligence Worker API",
    endpoint: "/fetch-metadata?video_id=VIDEO_ID",
  });
});

// Main metadata endpoint
app.get("/fetch-metadata", async (c) => {
  const videoId = c.req.query("video_id");

  if (!videoId) {
    return c.json({ error: "Missing video_id parameter" }, 400);
  }

  try {
    const apiKey = c.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("[fetch-metadata] Server misconfigured: Missing YOUTUBE_API_KEY");
      return c.json({ error: "Server misconfigured" }, 500);
    }

    const scraper = new MetadataScraper(apiKey, c.env.RESIDENTIAL_PROXY_URL);
    let metadata = await scraper.fetch(videoId);

    // Metadata Hardening: Fallback fetch for channel details
    if (!metadata.channelTitle && metadata.channelId) {
      console.info(`[fetch-metadata] Incomplete metadata, fetching channel details for ${metadata.channelId}`);
      try {
        const channelDetails = await scraper.fetchChannelDetails(metadata.channelId);
        metadata = {
          ...metadata,
          channelTitle: channelDetails.title,
        };
      } catch (e) {
        console.error(`[fetch-metadata] Channel detail fetch failed: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }

    return c.json(metadata, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("Timeout") || errorMessage === "AbortError") {
      console.error(`[fetch-metadata] Timeout for video ${videoId}`);
      return c.json({ error: "Request timeout" }, 504);
    }

    console.error(`[fetch-metadata] Error for video ${videoId}:`, errorMessage);
    return c.json(
      { error: "Failed to fetch video metadata. Please try again later." },
      500
    );
  }
});

// Transcript extraction endpoint
app.post("/fetch-transcript", async (c) => {
  const body = await c.req.json() as { videoId?: string };
  const videoId = body.videoId || c.req.query("video_id");

  if (!videoId) {
    return c.json({ error: "Missing videoId parameter" }, 400);
  }

  try {
    const extractor = new TranscriptExtractor(c.env.RESIDENTIAL_PROXY_URL, c.env.DECODO_API_KEY);
    const result = await extractor.fetch(videoId);

    return c.json(
      {
        ...result,
        length: result.transcript.length,
      },
      200,
      {
        "Cache-Control": "public, max-age=86400",
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("Timeout") || errorMessage === "AbortError") {
      console.error(`[fetch-transcript] Timeout fetching transcript for ${videoId}`);
      return c.json({ error: "Transcript fetch timeout" }, 504);
    }

    if (errorMessage.includes("No captions") || errorMessage.includes("empty")) {
      return c.json({ error: errorMessage }, 404);
    }

    console.error(`[fetch-transcript] Error for ${videoId}:`, errorMessage);
    return c.json(
      { error: "Failed to fetch transcript. Please try again later." },
      500
    );
  }
});

// Analytics endpoint (optional)
app.post("/log-analysis", async (c) => {
  const body = await c.req.json();
  // Log analysis requests for analytics
  // (In production: send to analytics service)
  return c.json({ logged: true });
});

// LLM Analysis endpoint with 5-tier cascade + Upstash KV caching + 12D validation
// POST /analyze-llm with { videoId, transcript, metadata, persona, timezone, systemPrompt? }
app.post("/analyze-llm", async (c) => {
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

  const request = (await c.req.json()) as AnalysisRequest;

  if (!request.videoId || !request.transcript || !request.metadata) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  try {
    const apiKey = c.env.OPENROUTER_API_KEY;
    const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;

    if (!apiKey) {
      console.error('[analyze-llm] Server misconfigured: Missing OPENROUTER_API_KEY');
      return c.json({ success: false, error: 'Server misconfigured' }, 500);
    }

    if (!upstashUrl || !upstashToken) {
      console.warn('[analyze-llm] Upstash not configured, proceeding without caching');
    }

    // Orchestrate: delegate cascade + caching to the ReasoningEngine via DI.
    const cache =
      upstashUrl && upstashToken
        ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken })
        : undefined;
    const engine: ReasoningEnginePort = new ReasoningEngine(
      new PromptBuilder(),
      new LLMCascade(apiKey),
      new ValidationService(),
      cache
    );

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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[analyze-llm] Error:', message);

    return c.json({
      success: false,
      error: message,
    }, 500);
  }
});

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

async function verifyStreamToken(
  videoId: string,
  analysisId: string,
  exp: number,
  sig: string,
  models: string[] | undefined,
  env: Env
): Promise<TokenVerificationResult> {
  const secret = env.STREAM_HMAC_SECRET;

  if (Date.now() > exp) {
    return { isValid: false, secret: '', msg: '' };
  }

  let activeSecret = secret;
  const secretsToTry = [secret];

  if (env.DEV_HMAC_SECRET) {
    secretsToTry.push(env.DEV_HMAC_SECRET);
  }
  secretsToTry.push('dev-hmac-secret-123');

  for (const s of secretsToTry) {
    if (!s) continue;
    const modelStr = [...(models ?? [])].sort().join(',');
    const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
    const expected = await hmacHex(s, msg);

    if (timingSafeEqualHex(expected, sig)) {
      return { isValid: true, secret: s, msg: '' };
    }
  }

  const modelStr = [...(models ?? [])].sort().join(',');
  const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
  return { isValid: false, secret: activeSecret, msg };
}

async function fetchTranscriptIfMissing(
  transcript: string | undefined,
  videoId: string,
  env: Pick<Env, 'RESIDENTIAL_PROXY_URL' | 'DECODO_API_KEY'>,
  channelId?: string
): Promise<string | undefined> {
  const isPlaceholder = transcript?.includes('Transcript unavailable for this video');

  if (!transcript || transcript.trim().length === 0 || isPlaceholder) {
    console.info(`[analyze-llm-stream] Transcript missing or placeholder, attempting fetch for ${videoId}`);
    try {
      const extractor = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY);
      const [result, channelMeta] = await Promise.all([
        extractor.fetch(videoId),
        channelId
          ? extractor.fetchChannelMetadata(channelId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (result.transcript && result.transcript.trim().length > 0 && !result.transcript.includes('Transcript unavailable')) {
        transcript = result.transcript;
        console.info(`[analyze-llm-stream] Fetch successful for ${videoId}`);
      }
      if (channelMeta) {
        console.info(`[analyze-llm-stream] Channel metadata enriched for ${channelId}`);
      }
    } catch (e) {
      console.error(`[analyze-llm-stream] Fetch failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
      if (!transcript) {
        transcript = '[Transcript unavailable for this video - content ingestion failed across all available sources]';
      }
    }
  }

  return transcript;
}

function buildStreamResponse(
  engine: ReasoningEnginePort,
  req: StreamRequest,
  activeSecret: string,
  appUrl: string | undefined,
  signal: AbortSignal,
  waitUntil: (p: Promise<unknown>) => void
): Response {
  const encoder = new TextEncoder();
  let finalText = '';
  let modelUsed = '';

  const persistService = new PersistService();

  const atomicPersist = createAtomicPersist({
    hasContent: () => finalText.length > 0,
    persist: async (status) => {
      const url = appUrl || 'https://yt-intel.getmytestdrive.com';
      return persistService.persist({
        analysisId: req.analysisId,
        videoId: req.videoId,
        finalText,
        modelUsed,
        status,
        activeSecret,
        appUrl: url,
        validate12D: (text: string) => engine.validate12D(text),
        chunkIndex: req.chunkIndex,
        totalChunks: req.totalChunks,
      });
    },
    signal,
    waitUntil,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* client gone */ }
      };

      try {
        send({ type: 'status', stage: 'starting', videoId: req.videoId });

        const result = await engine.executeAndStream(
          {
            metadata: req.metadata,
            transcript: req.transcript || '',
            persona: req.persona,
            timezone: req.timezone,
            dimensions: req.dimensions,
          },
          {
            onDelta: (delta) => {
              finalText += delta;
              send({ type: 'delta', content: delta });
            },
            onFragment: (fragment) => send(fragment),
            onStatus: (statusEvent) => {
              if (statusEvent.stage === 'model' && statusEvent.model) {
                modelUsed = statusEvent.model;
              }
              send({ type: 'status', ...statusEvent });
            },
          },
          signal
        );

        if (!result.produced && !result.finalText) {
          send({ type: 'error', error: 'All models in cascade failed to produce output' });
          controller.close();
          return;
        }

        send({ type: 'complete', model: result.modelUsed, valid: result.valid, videoId: req.videoId, analysisId: req.analysisId });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'stream failed' });
      } finally {
        atomicPersist.flush();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Direct browser->worker SSE streaming. Vercel mints the HMAC token (after auth +
 * quota) and the browser connects here directly, so the slow LLM stream never goes
 * through Vercel's 60s function ceiling. The worker holds the connection open (no
 * Cloudflare duration limit while the client is connected), builds the UCIS prompt
 * internally (IP stays server-side), streams tokens, and signs the final markdown.
 */
app.post("/analyze-llm-stream", async (c) => {
  const req = (await c.req.json()) as StreamRequest;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!req.videoId || !req.analysisId || !req.metadata || !req.sig || !req.exp) {
    const missing = [];
    if (!req.videoId) missing.push('videoId');
    if (!req.analysisId) missing.push('analysisId');
    if (!req.metadata) missing.push('metadata');
    if (!req.sig) missing.push('sig');
    if (!req.exp) missing.push('exp');
    return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  if (!isValidAppUrl(req.appUrl, c.env.APP_URL, c.env.ALLOWED_APP_ORIGINS, c.env.NODE_ENV === 'production')) {
    console.warn('[analyze-llm-stream] Blocked untrusted appUrl callback redirect:', req.appUrl);
    return c.json({ error: 'Invalid appUrl callback destination' }, 400);
  }

  const transcript = await fetchTranscriptIfMissing(
    req.transcript, req.videoId,
    { RESIDENTIAL_PROXY_URL: c.env.RESIDENTIAL_PROXY_URL, DECODO_API_KEY: c.env.DECODO_API_KEY },
    (req.metadata as { channelId?: string }).channelId
  );

  if (!transcript || !transcript.trim() || transcript.includes('Transcript unavailable') || transcript.includes('content ingestion failed')) {
    return c.json({
      error: 'No transcript available',
      details: 'Transcript could not be fetched from any source. LLM analysis skipped to avoid unnecessary costs.',
    }, 400);
  }

  if (!c.env.STREAM_HMAC_SECRET || !apiKey) {
    console.error('[analyze-llm-stream] Server misconfigured: missing STREAM_HMAC_SECRET or OPENROUTER_API_KEY');
    return c.json({ error: 'Server misconfigured' }, 500);
  }

  const { isValid: isTokenValid, secret: activeSecret, msg } = await verifyStreamToken(
    req.videoId, req.analysisId, req.exp, req.sig, req.models, c.env
  );

  if (!isTokenValid) {
    const isPreview = c.env.NODE_ENV !== 'production';
    if (isPreview) {
      console.warn('[analyze-llm-stream] HMAC Mismatch Diagnostic:', {
        providedSig: req.sig,
        message: msg,
        secretUsed: activeSecret === 'dev-hmac-secret-123' ? 'FALLBACK' : 'CONFIGURED',
      });
      return c.json({
        error: 'Invalid token',
        debug: {
          msg,
          sig: req.sig,
          secret: activeSecret === 'dev-hmac-secret-123' ? 'FALLBACK' : 'CONFIGURED',
        },
      }, 401);
    }
    return c.json({ error: 'Invalid token' }, 401);
  }

  const engine: ReasoningEnginePort = new ReasoningEngine(
    new PromptBuilder(),
    new LLMCascade(apiKey, req.models),
    new ValidationService(),
    undefined
  );

  return buildStreamResponse(
    engine, req, activeSecret, req.appUrl || c.env.APP_URL,
    c.req.raw.signal, (p) => c.executionCtx.waitUntil(p)
  );
});

// Direct browser->worker chat streaming (HMAC-gated; persists S2S). Keeps
// conversational tokens off the Vercel function path. See ./chat-stream.
app.post("/chat-stream", handleChatStream);

export default app;
