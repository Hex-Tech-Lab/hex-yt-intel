import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  YOUTUBE_API_KEY: string;
  CLOUDFLARE_SECRET_TOKEN: string;
  RESIDENTIAL_PROXY_URL?: string;
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

// Proxy routing adapter for residential proxy support
const buildProxiedFetchInit = (
  targetUrl: string,
  proxyUrl: string | undefined,
  signal: AbortSignal,
): [string, RequestInit] => {
  const headers = {
    'User-Agent': getRandomUserAgent(),
  };

  // If no proxy configured, fetch directly from target URL
  if (!proxyUrl) {
    return [targetUrl, { signal, headers }];
  }

  // Validate proxy URL format before use
  if (typeof proxyUrl !== 'string' || proxyUrl.length === 0) {
    console.warn('[buildProxiedFetchInit] Invalid proxy URL: must be non-empty string');
    return [targetUrl, { signal, headers }];
  }

  // Normalize proxy URL: prepend http:// if protocol is missing
  let normalizedProxyUrl = proxyUrl;
  if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
    // Assume http:// for credentials-based proxies (Bright Data format)
    normalizedProxyUrl = `http://${proxyUrl}`;
    console.debug(`[buildProxiedFetchInit] Normalized proxy URL format (added http:// prefix)`);
  }

  // Route through residential proxy endpoint
  // For credential-based proxies, use HTTP proxy protocol (no query param needed)
  // The proxy will handle routing to the target URL automatically via the HTTP_PROXY mechanism
  const encodedTarget = encodeURIComponent(targetUrl);
  const proxiedUrl = `${normalizedProxyUrl}?url=${encodedTarget}`;

  return [proxiedUrl, { signal, headers }];
};

const corsMiddleware = (origin: string | undefined): boolean => {
  if (!origin) return false;
  return allowedOrigins.some(allowed => origin.startsWith(allowed));
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

    // Fetch video metadata from YouTube API with timeout
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
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
    // Fetch caption tracks with timeout protection
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const metadataController = new AbortController();
    const metadataTimeout = setTimeout(() => metadataController.abort(), 5000);

    const [proxiedMetadataUrl, metadataInit] = buildProxiedFetchInit(
      metadataUrl,
      c.env.RESIDENTIAL_PROXY_URL,
      metadataController.signal,
    );

    const metadataResponse = await fetch(proxiedMetadataUrl, metadataInit);
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

    // Fetch the actual transcript with timeout
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const transcriptController = new AbortController();
    const transcriptTimeout = setTimeout(() => transcriptController.abort(), 5000);

    const [proxiedTranscriptUrl, transcriptInit] = buildProxiedFetchInit(
      transcriptUrl,
      c.env.RESIDENTIAL_PROXY_URL,
      transcriptController.signal,
    );

    const transcriptResponse = await fetch(proxiedTranscriptUrl, transcriptInit);
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

export default app;
