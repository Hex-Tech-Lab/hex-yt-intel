import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  YOUTUBE_API_KEY: string;
  CLOUDFLARE_SECRET_TOKEN: string;
};

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS to approved origins only
const allowedOrigins = [
  'https://hex-yt-intel.vercel.app',
  'http://localhost:3000',
  'http://localhost:3005',
];

app.use("*", cors({
  origin: allowedOrigins,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Shared authentication middleware for protected endpoints
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  const token = c.env.CLOUDFLARE_SECRET_TOKEN;

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const providedToken = authHeader.slice(7);
  if (providedToken !== token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};

// Apply auth middleware to protected endpoints
app.use("/fetch-metadata", authMiddleware);
app.use("/fetch-transcript", authMiddleware);
app.use("/log-analysis", authMiddleware);

// Apply auth middleware to protected endpoints
app.use("/fetch-metadata", authMiddleware);
app.use("/fetch-transcript", authMiddleware);
app.use("/log-analysis", authMiddleware);

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

  // Validate video ID format (11 characters, alphanumeric + - _)
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return c.json({ error: "Invalid video_id format" }, 400);
  }

  try {
    const apiKey = c.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return c.json(
        { error: "Server misconfigured: Missing YOUTUBE_API_KEY" },
        500
      );
    }

    // Fetch video metadata from YouTube API
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${apiKey}`;

    const response = await fetch(url);
    const data = (await response.json()) as {
      items?: Array<{ snippet: unknown; statistics: unknown; contentDetails: unknown }>;
    };

    if (!data.items || data.items.length === 0) {
      return c.json({ error: "Video not found" }, 404);
    }

    const video = data.items[0];
    const snippet = video.snippet;
    const stats = video.statistics;
    const details = video.contentDetails;

    // Parse ISO 8601 duration to seconds
    const parseDuration = (duration: string): number => {
      const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
      const hours = parseInt(match?.[1] || "0") * 3600;
      const minutes = parseInt(match?.[2] || "0") * 60;
      const seconds = parseInt(match?.[3] || "0");
      return hours + minutes + seconds;
    };

    return c.json(
      {
        videoId: videoId,
        title: snippet.title,
        description: snippet.description,
        channelTitle: snippet.channelTitle,
        channelId: snippet.channelId,
        publishedAt: snippet.publishedAt,
        duration: parseDuration(details.duration),
        viewCount: parseInt(stats.viewCount || "0", 10),
        likeCount: parseInt(stats.likeCount || "0", 10),
        commentCount: parseInt(stats.commentCount || "0", 10),
        thumbnailUrl: snippet.thumbnails.high.url,
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Worker error for video ${videoId}:`, errorMessage);
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
    const apiKey = c.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return c.json(
        { error: "Server misconfigured: Missing YOUTUBE_API_KEY" },
        500
      );
    }

    // Use YouTube Captions API to fetch transcript
    // First, get video ID and fetch caption tracks
    const url = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;

    const response = await fetch(url);
    if (!response.ok) {
      return c.json({ error: "Failed to fetch transcript metadata" }, 404);
    }

    const text = await response.text();

    // Parse XML response to find caption tracks
    const captionMatch = text.match(/lang_code="([^"]+)"[^>]*name="([^"]+)"/);
    if (!captionMatch) {
      return c.json({ error: "No captions available for this video" }, 404);
    }

    const langCode = captionMatch[1];

    // Fetch the actual transcript
    const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const captionResponse = await fetch(captionUrl);

    if (!captionResponse.ok) {
      return c.json({ error: "Failed to fetch transcript content" }, 500);
    }

    const captionData = (await captionResponse.json()) as {
      events?: Array<{ tStartMs: string; dur: string; segs?: Array<{ utf8: string }> }>;
    };

    if (!captionData.events) {
      return c.json({ error: "No transcript events found" }, 404);
    }

    // Reconstruct transcript from events
    const transcript = captionData.events
      .map((event) => {
        const segments = event.segs || [];
        return segments.map((seg) => seg.utf8).join("");
      })
      .join(" ")
      .replace(/\n/g, " ")
      .trim();

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
    console.error(`Worker error fetching transcript for ${videoId}:`, errorMessage);
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
