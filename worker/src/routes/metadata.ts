import { Hono } from "hono";
import { MetadataScraper } from "../services/MetadataScraper";

type MetadataEnv = {
  YOUTUBE_API_KEY: string;
  RESIDENTIAL_PROXY_URL?: string;
};

const metadata = new Hono<{ Bindings: MetadataEnv }>();

metadata.get("/fetch-metadata", async (c) => {
  const videoId = c.req.query("video_id");

  if (!videoId) {
    return c.json({ error: "Missing video_id parameter" }, 400);
  }

  try {
    const apiKey = c.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.warn("[fetch-metadata] YOUTUBE_API_KEY not configured, falling back to public oEmbed resolution", { videoId });
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      if (oembedRes && oembedRes.ok) {
        const oembed = (await oembedRes.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        return c.json(
          {
            videoId,
            title: oembed.title || "YouTube Video",
            description: "",
            channelTitle: oembed.author_name || "",
            channelId: "",
            publishedAt: new Date().toISOString(),
            duration: null,
            viewCount: 0,
            likeCount: 0,
            commentCount: 0,
            thumbnailUrl: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          },
          200,
          { "Cache-Control": "public, max-age=3600" }
        );
      }

      console.error("[fetch-metadata] Server misconfigured: Missing YOUTUBE_API_KEY and oEmbed failed");
      return c.json({ error: "Server misconfigured" }, 500);
    }

    const scraper = new MetadataScraper(apiKey, c.env.RESIDENTIAL_PROXY_URL);
    let metadata = await scraper.fetch(videoId);

    if (!metadata.channelTitle && metadata.channelId) {
      console.info(`[fetch-metadata] Incomplete metadata, fetching channel details for ${metadata.channelId}`);
      try {
        const channelDetails = await scraper.fetchChannelDetails(metadata.channelId);
        metadata = {
          ...metadata,
          channelTitle: channelDetails.title,
        };
      } catch (channelError) {
        console.error(`[fetch-metadata] Channel detail fetch failed: ${channelError instanceof Error ? channelError.message : "Unknown"}`);
      }
    }

    return c.json(metadata, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("Timeout") || errorMessage === "AbortError") {
      console.error(`[fetch-metadata] Timeout for video ${videoId}`);
      return c.json({ error: "Request timeout" }, 504);
    }

    console.error(`[fetch-metadata] Error for video ${videoId}:`, errorMessage);
    return c.json(
      { error: "Failed to fetch video metadata. Please try again later." },
      500,
    );
  } finally {
    // request processing done
  }
});

export default metadata;
