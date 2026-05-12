import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  YOUTUBE_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// Enable CORS
app.use("*", cors());

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
    const data = await response.json();

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
        video_id: videoId,
        title: snippet.title,
        description: snippet.description,
        channel: snippet.channelTitle,
        channel_id: snippet.channelId,
        published_at: snippet.publishedAt,
        duration: parseDuration(details.duration),
        views: parseInt(stats.viewCount || "0"),
        likes: parseInt(stats.likeCount || "0"),
        comments: parseInt(stats.commentCount || "0"),
        thumbnail_url: snippet.thumbnails.high.url,
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: `Failed to fetch metadata: ${errorMessage}` }, 500);
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
