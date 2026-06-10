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
import { reconstructMarkdown, extractJsonPayload } from "./services/MarkdownReconstructor";
import type { ReasoningEnginePort } from "./ports/ReasoningEnginePort";

type Env = {
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
};

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS to approved origins only
const allowedOrigins = [
  'https://hex-yt-intel.vercel.app',
  'https://yt-intel.getmytestdrive.com',
  'http://localhost:3000',
  'http://localhost:3005',
];

// --- HMAC (Web Crypto) ----------------------------------------------------
// Shared-secret signing for the direct-streaming gate + tamper-proof persistence.
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time hex compare (avoids early-exit timing leaks).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    const metadata = await scraper.fetch(videoId);

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
    const extractor = new TranscriptExtractor(c.env.RESIDENTIAL_PROXY_URL);
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

/**
 * Direct browser->worker SSE streaming. Vercel mints the HMAC token (after auth +
 * quota) and the browser connects here directly, so the slow LLM stream never goes
 * through Vercel's 60s function ceiling. The worker holds the connection open (no
 * Cloudflare duration limit while the client is connected), builds the UCIS prompt
 * internally (IP stays server-side), streams tokens, and signs the final markdown.
 */
app.post("/analyze-llm-stream", async (c) => {
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
    // Per-tier model cascade resolved by the bouncer (app_settings). Bound into the
    // HMAC below so a client can't swap in expensive models. Absent → worker default.
    models?: string[];
    sig: string;
    exp: number;
  }

  const req = (await c.req.json()) as StreamRequest;
  const secret = c.env.STREAM_HMAC_SECRET;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!req.videoId || !req.analysisId || !req.metadata || !req.sig || !req.exp) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Edge Hardening: Defensive check for empty transcript to prevent prompt collapse
  if (!req.transcript || req.transcript.trim().length === 0) {
    console.error('[analyze-llm-stream] Empty transcript received at edge');
    return c.json({ 
      error: 'Empty transcript payload. The edge worker requires a source transcript to generate a synthesis.',
      code: 'ERR_EDGE_EMPTY_SOURCE' 
    }, 400);
  }

  if (!secret || !apiKey) {
    console.error('[analyze-llm-stream] Server misconfigured: missing STREAM_HMAC_SECRET or OPENROUTER_API_KEY');
    return c.json({ error: 'Server misconfigured' }, 500);
  }

  // Verify the Vercel-minted token: bound to videoId + analysisId + expiry. Without
  // this anyone could hit the worker directly and burn OpenRouter quota.
  if (Date.now() > req.exp) {
    return c.json({ error: 'Token expired' }, 401);
  }
  // The models list is bound into the signature (byte-identical JSON.stringify the
  // bouncer used): the token authorizes THIS exact cascade, so model selection is
  // tamper-proof. JSON (not join) avoids comma-in-id aliasing.
  const expected = await hmacHex(
    secret,
    `${req.videoId}.${req.analysisId}.${req.exp}.${JSON.stringify(req.models ?? [])}`
  );
  if (!timingSafeEqualHex(expected, req.sig)) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Instantiate the reasoning engine via DI. It builds the UCIS prompt server-side
  // and runs the model cascade — the orchestrator only wires domain events to SSE.
  // No cache on the streaming path (partial-progress persistence handled by worker).
  const engine: ReasoningEnginePort = new ReasoningEngine(
    new PromptBuilder(),
    new LLMCascade(apiKey, req.models),
    new ValidationService(),
    undefined
  );

  const encoder = new TextEncoder();

  // The orchestrator keeps its own copy of the accumulating markdown + model name so
  // it can persist partial progress on browser disconnect (the engine is transport-
  // and persistence-agnostic by design).
  let finalText = '';
  let modelUsed = '';
  let persisted = false;

  const persist = async (status: 'completed' | 'interrupted') => {
    if (persisted || !finalText) return;

    let markdown = finalText;
    let jsonPayload: Record<string, unknown> | null = null;
    const extracted = extractJsonPayload(finalText);
    if (extracted) {
      jsonPayload = extracted;
      markdown = reconstructMarkdown(extracted);
    }

    const canonical = JSON.stringify({ markdown, payload: jsonPayload });
    const valid = engine.validate12D(markdown);
    const contentSig = await hmacHex(secret, canonical);
    const appUrl = c.env.APP_URL || 'https://yt-intel.getmytestdrive.com';

    persisted = true;
    await fetch(`${appUrl}/api/analyses/persist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisId: req.analysisId,
        videoId: req.videoId,
        markdown,
        payload: jsonPayload,
        model: modelUsed,
        valid,
        contentSig,
        status,
      }),
    }).catch((e) => {
      persisted = false;
      console.error(`[analyze-llm-stream] ${status} persist failed`, e);
    });
  };

  // Detect browser disconnect immediately and save partial progress.
  c.req.raw.signal.addEventListener('abort', () => {
    if (!persisted) {
      c.executionCtx.waitUntil(persist('interrupted'));
    }
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
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
          c.req.raw.signal
        );

        if (!result.produced && !result.finalText) {
          send({ type: 'error', error: 'All models in cascade failed to produce output' });
          controller.close();
          return;
        }

        // Mark stream complete
        send({ type: 'complete', model: result.modelUsed, valid: result.valid, videoId: req.videoId, analysisId: req.analysisId });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'stream failed' });
      } finally {
        // Last-ditch persistence on success or crash (if not already triggered by abort).
        if (finalText && !persisted) {
          c.executionCtx.waitUntil(persist('completed'));
        }
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
});

// Direct browser->worker chat streaming (HMAC-gated; persists S2S). Keeps
// conversational tokens off the Vercel function path. See ./chat-stream.
app.post("/chat-stream", handleChatStream);

export default app;
