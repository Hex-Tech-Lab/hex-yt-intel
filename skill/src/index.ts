import { z } from "zod";
import { ULTIMATE_CONTENT_INTELLIGENCE_V3_2 } from "./prompts";

const CLOUDFLARE_WORKER_URL =
  process.env.CLOUDFLARE_WORKER_URL ||
  "https://yt-intel.hex-tech-lab.workers.dev";

const CLOUDFLARE_SECRET_TOKEN = process.env.CLOUDFLARE_SECRET_TOKEN;

if (!CLOUDFLARE_SECRET_TOKEN) {
  throw new Error(
    "Missing CLOUDFLARE_SECRET_TOKEN environment variable. Please set it to authenticate with the worker."
  );
}

const youtubeUrlSchema = z
  .string()
  .transform((url) => {
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    return normalizedUrl;
  })
  .refine((url) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === "youtube.com" ||
        host === "www.youtube.com" ||
        host === "m.youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtu.be"
      );
    } catch {
      return false;
    }
  }, "Invalid YouTube URL")
  .transform((url) => {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    let videoId = "";
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      videoId = parsed.pathname.slice(1);
    } else if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/")[2] ?? "";
    } else if (parsed.pathname.startsWith("/v/")) {
      videoId = parsed.pathname.split("/")[2] ?? "";
    } else {
      videoId = parsed.searchParams.get("v") ?? "";
    }
    return videoId;
  })
  .refine((id) => /^[a-zA-Z0-9_-]{11}$/.test(id), {
    message: "Invalid video ID format",
  });

interface YouTubeMetadata {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  thumbnailUrl: string;
}

function parseYouTubeUrl(url: string): string {
  const result = youtubeUrlSchema.safeParse(url);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(
      `Invalid YouTube URL: ${url}. ${errors}. Expected format: https://www.youtube.com/watch?v=VIDEO_ID`
    );
  }
  return result.data;
}

async function fetchMetadata(
  videoId: string
): Promise<YouTubeMetadata> {
  try {
    // Validate worker URL against SSRF allowlist (exact hostname match only)
    const allowedOrigins = new Set([
      'yt-intel.hex-tech-lab.workers.dev',
    ]);

    const urlObj = new URL(CLOUDFLARE_WORKER_URL);
    const isAllowedOrigin = urlObj.protocol === 'https:' && allowedOrigins.has(urlObj.hostname);

    if (!isAllowedOrigin) {
      throw new Error(`Worker URL origin '${urlObj.hostname}' is not in approved allowlist. SSRF prevention enforced.`);
    }

    const response = await fetch(
      `${CLOUDFLARE_WORKER_URL}/fetch-metadata?video_id=${videoId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CLOUDFLARE_SECRET_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Worker returned ${response.status}: ${response.statusText}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (!data || typeof data !== "object") {
      throw new Error("Invalid response: Expected JSON object from worker");
    }

    // Validate required fields
    if (!data.title || typeof data.title !== "string") {
      throw new Error("Invalid response: missing or invalid title field");
    }

    return {
      videoId: videoId,
      title: data.title,
      description:
        typeof data.description === "string" ? data.description : "",
      channelTitle:
        typeof data.channelTitle === "string"
          ? data.channelTitle
          : "Unknown Channel",
      channelId:
        typeof data.channelId === "string" ? data.channelId : "unknown",
      duration: parseInt(String(data.duration || "0"), 10) || 0,
      viewCount: parseInt(String(data.viewCount || "0"), 10) || 0,
      likeCount: parseInt(String(data.likeCount || "0"), 10) || 0,
      commentCount: parseInt(String(data.commentCount || "0"), 10) || 0,
      publishedAt:
        typeof data.publishedAt === "string" ? data.publishedAt : "Unknown Date",
      thumbnailUrl:
        typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : "",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch YouTube metadata for video ${videoId}: ${errorMessage}`
    );
  }
}

function formatAnalysisPrompt(metadata: YouTubeMetadata): string {
  const minutes = Math.floor(metadata.duration / 60);
  const seconds = metadata.duration % 60;

  const metadataSection = `# YouTube Content Intelligence Report

## Video Metadata
- **Title:** ${metadata.title}
- **Creator:** ${metadata.channelTitle}
- **Upload Date:** ${metadata.publishedAt}
- **Duration:** ${minutes}m ${seconds}s
- **Views:** ${metadata.viewCount.toLocaleString()}
- **Engagement:** Likes ${metadata.likeCount.toLocaleString()}, Comments ${metadata.commentCount.toLocaleString()}
- **Video ID:** ${metadata.videoId}
- **Thumbnail:** ${metadata.thumbnailUrl}

## Video Description
${metadata.description}

---

## Content for Analysis

**Framework**: Ultimate Content Intelligence v3.2 (16 Sections)

Analyze this video using the comprehensive 16-section framework below. Generate detailed intelligence across all sections with specific timestamps, actionable insights, and implementation pathways.

---

${ULTIMATE_CONTENT_INTELLIGENCE_V3_2}`;

  return metadataSection;
}

async function main() {
  const youtubeUrl = process.argv[2];

  if (!youtubeUrl) {
    console.error("Usage: pnpm tsx skill/src/index.ts <YouTube URL>");
    process.exit(1);
  }

  console.log("🎬 YouTube Content Intelligence Skill");
  console.log("=====================================\n");

  try {
    console.log("📍 Parsing YouTube URL...");
    const videoId = parseYouTubeUrl(youtubeUrl);
    console.log(`✓ Video ID: ${videoId}\n`);

    console.log("🌐 Fetching metadata from Cloudflare Worker...");
    const metadata = await fetchMetadata(videoId);
    console.log(`✓ Title: ${metadata.title}`);
    console.log(`✓ Channel: ${metadata.channelTitle}`);
    console.log(`✓ Views: ${metadata.viewCount.toLocaleString()}`);
    console.log(
      `✓ Engagement: ${metadata.likeCount.toLocaleString()} likes, ${metadata.commentCount.toLocaleString()} comments\n`
    );

    console.log("📋 Generating analysis prompt for Claude...");
    const prompt = formatAnalysisPrompt(metadata);
    console.log("✓ Prompt generated\n");

    console.log("=====================================");
    console.log(prompt);
    console.log("=====================================\n");

    console.log("✨ READY FOR CLAUDE ANALYSIS");
    console.log(
      "Copy the prompt above and use it with Claude for comprehensive content intelligence analysis.\n"
    );

    return {
      success: true,
      prompt,
      metadata,
      instructions:
        "Use this prompt with Claude (Claude 3.5 Sonnet recommended) for detailed analysis",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${errorMessage}`);
    process.exit(1);
  }
}

main();
