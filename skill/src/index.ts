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
  // Normalize to HTTPS
  url = url.replace(/^http:/, "https:");

  // Validate domain
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    throw new Error(
      `Invalid YouTube URL: ${url}. Must be from youtube.com or youtu.be`
    );
  }

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const videoId = match[1];
      // Validate video ID format
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        throw new Error(`Invalid video ID format: ${videoId}`);
      }
      return videoId;
    }
  }

  throw new Error(
    `Invalid YouTube URL: ${url}. Expected format: https://www.youtube.com/watch?v=VIDEO_ID`
  );
}

async function fetchMetadata(
  videoId: string
): Promise<YouTubeMetadata> {
  try {
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

    // Validate required fields
    if (!data.title || typeof data.title !== "string") {
      throw new Error("Invalid response: missing or invalid title field");
    }
    if (typeof data.viewCount !== "number") {
      throw new Error(
        `Invalid response: viewCount should be number, got ${typeof data.viewCount}`
      );
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
      duration: typeof data.duration === "number" ? data.duration : 0,
      viewCount: typeof data.viewCount === "number" ? data.viewCount : 0,
      likeCount: typeof data.likeCount === "number" ? data.likeCount : 0,
      commentCount:
        typeof data.commentCount === "number" ? data.commentCount : 0,
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
