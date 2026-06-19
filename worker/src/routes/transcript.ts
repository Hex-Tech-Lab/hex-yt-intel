import { Hono } from "hono";
import { TranscriptExtractor } from "../services/TranscriptExtractor";

type TranscriptEnv = {
  RESIDENTIAL_PROXY_URL?: string;
  DECODO_API_KEY?: string;
};

const transcript = new Hono<{ Bindings: TranscriptEnv }>();

transcript.post("/fetch-transcript", async (c) => {
  const body = (await c.req.json()) as { videoId?: string };
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
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
      500,
    );
  } finally {
    // request processing done
  }
});

transcript.post("/log-analysis", async (c) => {
  await c.req.json();
  return c.json({ logged: true });
});

export default transcript;
