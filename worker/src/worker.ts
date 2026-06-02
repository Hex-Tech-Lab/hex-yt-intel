import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  YOUTUBE_API_KEY: string;
  CLOUDFLARE_SECRET_TOKEN: string;
  RESIDENTIAL_PROXY_URL?: string;
  OPENROUTER_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
};

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS to approved origins only
const allowedOrigins = [
  'https://hex-yt-intel.vercel.app',
  'http://localhost:3000',
  'http://localhost:3005',
];

// User-Agent rotation to bypass YouTube API restrictions
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
];

const getRandomUserAgent = (): string => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

async function fetchWithProxy(
  targetUrl: string,
  init: RequestInit = {},
  proxyUrl?: string
): Promise<Response> {
  if (!proxyUrl) return fetch(targetUrl, init);

  const atIndex = proxyUrl.lastIndexOf('@');
  if (atIndex === -1) return fetch(targetUrl, init);

  const credentials = proxyUrl.slice(0, atIndex);
  const hostPort = proxyUrl.slice(atIndex + 1);

  return fetch(targetUrl, {
    ...init,
    headers: {
      ...(typeof init.headers === 'object' && init.headers !== null
        ? (init.headers as Record<string, string>)
        : {}),
      'Proxy-Authorization': `Basic ${btoa(credentials)}`,
    },
    // @ts-ignore – Cloudflare Workers proxy extension
    proxy: `http://${hostPort}`,
  });
}

// ===================================================================
// LLM ANALYSIS PIPELINE – 3-MODEL CASCADE WITH UPSTASH KV CACHING
// ===================================================================

// 3-free + 1-paid model cascade – ordered best-first by a real latency+quality
// benchmark (2026-06-02) against the full v5.1 prompt. Under the ~55s request budget
// only ~1-2 attempts realistically complete, so tier 1 must be the proven performer.
//   - nemotron-3-nano-30b: ONLY free model that reliably produced valid 11-dim output
//     (3s first-token, 19-33s total). Lead model.
//   - glm-4.5-air / gemma-4-26b: $0 fallbacks, but volatile (429 / slow) — best effort.
//   - claude-haiku-4.5: paid last resort (needs OpenRouter credit; 402 while overdrawn).
// Models that FAILED the benchmark and were removed: gemma-4-31b (429), laguna-m.1
// (>120s), kimi-k2.6 (429), gpt-oss-120b / nemotron-120b (>120s — too slow for budget).
// NOTE: ":free" IDs need their providers enabled in the OpenRouter account allowlist
// or they 404 "no allowed providers". Paid IDs must NOT carry ":free".
const MODEL_CHAIN = [
  { model: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano 30B' },
  { model: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air' },
  { model: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B' },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (paid fallback)' },
] as const;

/**
 * Fingerprint system prompt using SHA-256
 * Ensures deterministic cache keys even as prompts evolve
 */
async function fingerprintSystemPrompt(prompt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build deterministic cache key combining prompt fingerprint + transcript length
 * Format: `analysis::<promptHash>::<transcriptLength>::<videoId>`
 */
async function buildCacheKey(
  systemPromptHash: string,
  transcriptLength: number,
  videoId: string
): Promise<string> {
  return `analysis::${systemPromptHash}::${transcriptLength}::${videoId}`;
}

/**
 * Upstash Redis REST API caching layer
 * GET: returns cached analysis or null
 * SET: stores analysis with 7-day TTL
 */
async function getFromUpstash(key: string, upstashUrl: string, upstashToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${upstashUrl}/get/${key}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${upstashToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { result: string | null };
    return data.result;
  } catch (error) {
    console.warn('[Upstash] GET failed, proceeding without cache hit');
    return null;
  }
}

async function setUpstash(key: string, value: string, upstashUrl: string, upstashToken: string): Promise<void> {
  try {
    await fetch(`${upstashUrl}/set/${key}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ex: 604800, // 7 days TTL in seconds
        get: false,
        xx: false,
      }),
    });
  } catch (error) {
    console.warn('[Upstash] SET failed, analysis succeeded but not cached');
  }
}

/**
 * Validate 12D analysis JSON structure
 * Ensures LLM output has required dimensions before caching
 */
function validate12D(analysis: any): boolean {
  if (typeof analysis !== 'object' || analysis === null) {
    return false;
  }

  // Check for markdown structure with 11 dimensions + apex summary
  const requiredDimensions = [
    'DIMENSION 1',
    'DIMENSION 2',
    'DIMENSION 3',
    'DIMENSION 4',
    'DIMENSION 5',
    'DIMENSION 6',
    'DIMENSION 7',
    'DIMENSION 8',
    'DIMENSION 9',
    'DIMENSION 10',
    'DIMENSION 11',
  ];

  // If analysis is markdown string, check for dimension headers
  if (typeof analysis === 'string') {
    return requiredDimensions.filter(dim => analysis.includes(dim)).length >= 8; // At least 8/11 dimensions
  }

  return false;
}

/**
 * Call LLM with timeout and streaming support
 * Returns text response from model
 */
async function callLLM(
  model: string,
  systemPrompt: string,
  transcript: string,
  metadata: any,
  apiKey: string,
  timeoutMs: number = 45000
): Promise<{ success: boolean; text?: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yt-intel.hex-tech-lab.workers.dev',
      },
      body: JSON.stringify({
        model,
        temperature: 1,
        // 16000 (not lower): nemotron-3-nano is a REASONING model that spends
        // ~4000 tokens on reasoning before the answer. An 8000 cap truncated the
        // 11-dimension output mid-stream and failed validation. Free models reserve
        // no credit, so this large cap costs nothing.
        max_tokens: 16000,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Analyze the following YouTube video transcript and metadata using the UCIS v5.1 framework.

**Metadata**:
${JSON.stringify(metadata, null, 2)}

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated...]' : ''}

Generate the complete 11-dimension analysis.`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `${response.status}: ${error.slice(0, 200)}`,
      };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;

    if (!text) {
      return { success: false, error: 'Empty response from LLM' };
    }

    return { success: true, text };
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'The operation was aborted') {
      return { success: false, error: 'Request timeout' };
    }

    return { success: false, error: message };
  }
}

// Return the request origin (not a boolean) when allowlisted, so Hono emits a
// valid `Access-Control-Allow-Origin: <origin>` header. Returning a boolean made
// Hono serialize the header literally as "true", which browsers reject. Server-
// to-server calls (no Origin) skip CORS entirely and are unaffected.
const corsMiddleware = (origin: string | undefined): string | null => {
  if (!origin) return null;
  return allowedOrigins.some(allowed => origin.startsWith(allowed)) ? origin : null;
};

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
    console.warn("[fetch-metadata] Missing video_id parameter");
    return c.json({ error: "Missing video_id parameter" }, 400);
  }

  // Validate video ID format (11 characters, alphanumeric + - _)
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    console.warn(`[fetch-metadata] Invalid video_id format: ${videoId}`);
    return c.json({ error: "Invalid video_id format" }, 400);
  }

  try {
    const apiKey = c.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("[fetch-metadata] Server misconfigured: Missing YOUTUBE_API_KEY");
      return c.json(
        { error: "Server misconfigured" },
        500
      );
    }

    // Fetch video metadata from YouTube API with timeout (optionally through proxy)
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetchWithProxy(
      url,
      {
        signal: controller.signal,
        headers: { 'User-Agent': getRandomUserAgent() },
      },
      c.env.RESIDENTIAL_PROXY_URL
    );
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[fetch-metadata] YouTube API returned ${response.status} for video ${videoId}`);
      return c.json({ error: "Video not found" }, 404);
    }

    const data = (await response.json()) as {
      items?: Array<{ snippet?: any; statistics?: any; contentDetails?: any }>;
      error?: any;
    };

    if (data.error) {
      console.warn(`[fetch-metadata] YouTube API error for ${videoId}:`, data.error);
      return c.json({ error: "Video not found" }, 404);
    }

    if (!data.items || data.items.length === 0) {
      console.warn(`[fetch-metadata] No items returned for ${videoId}`);
      return c.json({ error: "Video not found" }, 404);
    }

    const video = data.items[0];
    const snippet = video.snippet || {};
    const stats = video.statistics || {};
    const details = video.contentDetails || {};

    // Parse ISO 8601 duration to seconds
    const parseDuration = (duration: any): number => {
      if (!duration || typeof duration !== "string") return 0;
      const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
      if (!match) return 0;
      const hours = (parseInt(match[1] || "0") || 0) * 3600;
      const minutes = (parseInt(match[2] || "0") || 0) * 60;
      const seconds = parseInt(match[3] || "0") || 0;
      return hours + minutes + seconds;
    };

    // Get thumbnail URL with fallback chain: high → medium → default
    const getThumbnailUrl = (thumbnails: any): string => {
      if (!thumbnails || typeof thumbnails !== "object") return "";
      return (
        thumbnails.high?.url ||
        thumbnails.medium?.url ||
        thumbnails.default?.url ||
        ""
      );
    };

    return c.json(
      {
        videoId: videoId,
        title: String(snippet.title || ""),
        description: String(snippet.description || ""),
        channelTitle: String(snippet.channelTitle || ""),
        channelId: String(snippet.channelId || ""),
        publishedAt: String(snippet.publishedAt || ""),
        duration: parseDuration(details.duration),
        viewCount: parseInt(String(stats.viewCount || "0"), 10),
        likeCount: parseInt(String(stats.likeCount || "0"), 10),
        commentCount: parseInt(String(stats.commentCount || "0"), 10),
        thumbnailUrl: getThumbnailUrl(snippet.thumbnails),
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage === "The operation was aborted" || errorMessage === "AbortError") {
      console.error(`[fetch-metadata] Timeout for video ${videoId}`);
      return c.json(
        { error: "Request timeout" },
        504
      );
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

  // Validate video ID format (11 characters, alphanumeric + - _)
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return c.json({ error: "Invalid video_id format" }, 400);
  }

  try {
    // Fetch caption tracks with timeout protection (optionally through proxy)
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const metadataController = new AbortController();
    const metadataTimeout = setTimeout(() => metadataController.abort(), 5000);

    const metadataResponse = await fetchWithProxy(
      metadataUrl,
      {
        signal: metadataController.signal,
        headers: { 'User-Agent': getRandomUserAgent() },
      },
      c.env.RESIDENTIAL_PROXY_URL
    );
    clearTimeout(metadataTimeout);

    if (!metadataResponse.ok) {
      console.warn(`[fetch-transcript] Caption metadata fetch failed for ${videoId}: ${metadataResponse.status}`);
      return c.json({ error: "No transcript available for this video" }, 404);
    }

    const metadataText = await metadataResponse.text();

    // Parse XML response to find caption tracks - try English first, fallback to first available
    const captionRegex = /lang_code="([^"]+)"/g;
    const matches = Array.from(metadataText.matchAll(captionRegex));

    if (matches.length === 0) {
      console.warn(`[fetch-transcript] No captions found for ${videoId}`);
      return c.json({ error: "No captions available for this video" }, 404);
    }

    // Prioritize English, fallback to first available language
    let langCode = matches[0][1];
    const englishMatch = matches.find(m => m[1].startsWith('en'));
    if (englishMatch) {
      langCode = englishMatch[1];
    }

    // Fetch the actual transcript with timeout (optionally through proxy)
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const transcriptController = new AbortController();
    const transcriptTimeout = setTimeout(() => transcriptController.abort(), 5000);

    const transcriptResponse = await fetchWithProxy(
      transcriptUrl,
      {
        signal: transcriptController.signal,
        headers: { 'User-Agent': getRandomUserAgent() },
      },
      c.env.RESIDENTIAL_PROXY_URL
    );
    clearTimeout(transcriptTimeout);

    if (!transcriptResponse.ok) {
      console.warn(`[fetch-transcript] Transcript content fetch failed for ${videoId}: ${transcriptResponse.status}`);
      return c.json({ error: "Failed to fetch transcript content" }, 500);
    }

    const captionData = (await transcriptResponse.json()) as {
      events?: Array<{ tStartMs?: string; dur?: string; segs?: Array<{ utf8?: string }> }>;
    };

    if (!captionData.events || !Array.isArray(captionData.events)) {
      console.warn(`[fetch-transcript] No transcript events for ${videoId}`);
      return c.json({ error: "No transcript events found" }, 404);
    }

    // Reconstruct transcript from events
    const transcript = captionData.events
      .filter((event) => event && Array.isArray(event.segs) && event.segs.length > 0)
      .map((event) => {
        return event.segs.map((seg) => seg?.utf8 || "").join("");
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (transcript.length === 0) {
      console.warn(`[fetch-transcript] Empty transcript after parsing for ${videoId}`);
      return c.json({ error: "Transcript is empty" }, 404);
    }

    return c.json(
      {
        videoId,
        transcript,
        language: langCode,
        length: transcript.length,
      },
      200,
      {
        "Cache-Control": "public, max-age=86400",
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage === "The operation was aborted" || errorMessage === "AbortError") {
      console.error(`[fetch-transcript] Timeout fetching transcript for ${videoId}`);
      return c.json(
        { error: "Transcript fetch timeout" },
        504
      );
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

    // Use provided system prompt or default (would be UCIS v5.1 in production)
    const systemPrompt = request.systemPrompt || `# UCIS v5.1 Analysis Framework
Your task is to analyze YouTube video transcripts across 11 dimensions using the UCIS v5.1 framework.
Provide comprehensive analysis with all 11 dimensions in markdown format.`;

    // Fingerprint prompt for deterministic caching
    const promptHash = await fingerprintSystemPrompt(systemPrompt);
    const cacheKey = await buildCacheKey(
      promptHash,
      request.transcript.length,
      request.videoId
    );

    // Try Upstash cache first
    if (upstashUrl && upstashToken) {
      try {
        const cached = await getFromUpstash(cacheKey, upstashUrl, upstashToken);
        if (cached && validate12D(cached)) {
          return c.json({
            success: true,
            analysis: cached,
            model: 'cache-hit',
            cached: true,
          });
        }
      } catch (error) {
        console.warn('[analyze-llm] Upstash read failed, proceeding with LLM call');
      }
    }

    // 5-tier cascade – try each model until one succeeds with valid 12D output
    let analysisResult = null;
    let modelUsed = '';
    let validationPassed = false;

    for (const { model, name } of MODEL_CHAIN) {
      console.log(`[analyze-llm] Attempting ${name}...`);

      const result = await callLLM(
        model,
        systemPrompt,
        request.transcript,
        request.metadata,
        apiKey,
        45000 // Per-model timeout; absorbs nemotron 19-33s variance + headroom
      );

      if (result.success && result.text) {
        // Validate 12D structure before using
        if (validate12D(result.text)) {
          analysisResult = result.text;
          modelUsed = name;
          validationPassed = true;
          console.log(`[analyze-llm] Success with ${name}, validation passed`);
          break;
        } else {
          console.warn(`[analyze-llm] ${name} validation failed, trying next model`);
        }
      } else {
        console.warn(`[analyze-llm] Failed with ${name}: ${result.error}`);
      }
    }

    if (!analysisResult || !validationPassed) {
      return c.json({
        success: false,
        error: 'All models in cascade failed or validation failed',
      }, 502);
    }

    // Cache the validated result to Upstash
    if (upstashUrl && upstashToken) {
      try {
        await setUpstash(cacheKey, analysisResult, upstashUrl, upstashToken);
        console.log(`[analyze-llm] Cached to Upstash for ${request.videoId}`);
      } catch (error) {
        console.warn('[analyze-llm] Upstash write failed, but analysis succeeded');
      }
    }

    return c.json({
      success: true,
      analysis: analysisResult,
      model: modelUsed,
      cached: false,
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

export default app;
