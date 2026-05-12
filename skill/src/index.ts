import { ULTIMATE_CONTENT_INTELLIGENCE_V3_2 } from "./prompts";

const CLOUDFLARE_WORKER_URL =
  process.env.CLOUDFLARE_WORKER_URL ||
  "https://yt-intel.kellybakri.workers.dev";

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
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
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
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Worker returned ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      videoId: videoId,
      title: data.title || "Unknown Title",
      description: data.description || "",
      channelTitle: data.channelTitle || "Unknown Channel",
      channelId: data.channelId || "unknown",
      duration: data.duration || 0,
      viewCount: data.viewCount || 0,
      likeCount: data.likeCount || 0,
      commentCount: data.commentCount || 0,
      publishedAt: data.publishedAt || "Unknown Date",
      thumbnailUrl: data.thumbnailUrl || "",
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for ${videoId}:`, error);
    // Return minimal metadata on failure
    return {
      videoId: videoId,
      title: "Metadata unavailable",
      description: "",
      channelTitle: "Unknown",
      channelId: "unknown",
      duration: 0,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      publishedAt: "Unknown",
      thumbnailUrl: "",
    };
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
    console.log(`✓ Engagement: ${metadata.likeCount.toLocaleString()} likes, ${metadata.commentCount.toLocaleString()} comments\n`);

    console.log("📋 Generating analysis prompt for Claude...");
    const prompt = formatAnalysisPrompt(metadata);
    console.log("✓ Prompt generated\n");

    console.log("=====================================");
    console.log(prompt);
    console.log("=====================================\n");

    console.log("✨ READY FOR CLAUDE ANALYSIS");
    console.log("Copy the prompt above and use it with Claude for comprehensive content intelligence analysis.\n");

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
