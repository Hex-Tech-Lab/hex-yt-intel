const CLOUDFLARE_WORKER_URL =
  process.env.CLOUDFLARE_WORKER_URL ||
  "https://youtube-intelligence.workers.dev";

interface YouTubeMetadata {
  video_id: string;
  title: string;
  description: string;
  channel: string;
  channel_id: string;
  duration: number;
  views: number;
  likes: number;
  comments: number;
  published_at: string;
  thumbnail_url: string;
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
      video_id: videoId,
      title: data.title || "Unknown Title",
      description: data.description || "",
      channel: data.channel || "Unknown Channel",
      channel_id: data.channel_id || "unknown",
      duration: data.duration || 0,
      views: data.views || 0,
      likes: data.likes || 0,
      comments: data.comments || 0,
      published_at: data.published_at || "Unknown Date",
      thumbnail_url: data.thumbnail_url || "",
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for ${videoId}:`, error);
    // Return minimal metadata on failure
    return {
      video_id: videoId,
      title: "Metadata unavailable",
      description: "",
      channel: "Unknown",
      channel_id: "unknown",
      duration: 0,
      views: 0,
      likes: 0,
      comments: 0,
      published_at: "Unknown",
      thumbnail_url: "",
    };
  }
}

function formatAnalysisPrompt(metadata: YouTubeMetadata): string {
  const minutes = Math.floor(metadata.duration / 60);
  const seconds = metadata.duration % 60;

  return `# YouTube Content Intelligence Report

## Video Metadata
- **Title:** ${metadata.title}
- **Creator:** ${metadata.channel}
- **Upload Date:** ${metadata.published_at}
- **Duration:** ${minutes}m ${seconds}s
- **Views:** ${metadata.views.toLocaleString()}
- **Engagement:** Likes ${metadata.likes.toLocaleString()}, Comments ${metadata.comments.toLocaleString()}
- **Video ID:** ${metadata.video_id}
- **Thumbnail:** ${metadata.thumbnail_url}

## Video Description
${metadata.description}

---

## Analysis Required

Using the **Ultimate Content Intelligence v3.2 Framework**, analyze this video across the following 7 dimensions:

### 1. CONTENT STRUCTURE & FLOW
- Opening hook effectiveness (0-10 scoring)
- Narrative arc and pacing analysis
- Transition quality between segments
- Conclusion strength and CTA clarity

### 2. AUDIENCE INTELLIGENCE
- Target audience identification
- Psychographic profiling
- Pain points addressed
- Value proposition clarity
- Engagement signals present

### 3. TECHNICAL EXECUTION
- Production quality assessment
- Audio/visual balance
- Graphics and B-roll effectiveness
- Typography and branding consistency
- Platform optimization for YouTube

### 4. MESSAGE ARCHITECTURE
- Primary message (main thesis)
- Supporting arguments (3-5 key points)
- Social proof and authority signals
- Emotional triggers and persuasion techniques
- Call-to-action strategy

### 5. PERFORMANCE METRICS POTENTIAL
- Estimated viewer retention curve
- Likely engagement rate potential
- Viral potential (0-10 score)
- Algorithm-friendly elements present
- Monetization opportunities

### 6. COMPETITIVE POSITIONING
- Unique angle vs. similar content
- Content gap it fills
- Differentiation factors
- Positioning effectiveness

### 7. ACTIONABLE INSIGHTS
- Top 3 strengths to replicate in future content
- Top 3 improvement areas for next videos
- Benchmarks and performance comparisons
- Content reuse opportunities (blog, social, podcast)
- Cross-platform adaptation potential

---

## Instructions for Analysis

1. Provide structured analysis with clear sections
2. Use quantitative scoring (0-10) where applicable
3. Include specific, actionable recommendations
4. Balance critical analysis with recognition of strengths
5. Reference specific moments from the video when possible
6. Suggest concrete improvements with reasoning
7. Identify reuse and expansion opportunities

**Format:** Use markdown with headers, bullet points, and quantitative scores where relevant.
**Tone:** Professional yet accessible, analytical but not overly academic.
**Output:** Complete report ready for sharing with content creators and strategists.

---`;
}

async function main() {
  const youtubeUrl = process.argv[2];

  if (!youtubeUrl) {
    console.error("Usage: pnpm tsx skill/index.ts <YouTube URL>");
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
    console.log(`✓ Channel: ${metadata.channel}`);
    console.log(`✓ Views: ${metadata.views.toLocaleString()}`);
    console.log(`✓ Engagement: ${metadata.likes.toLocaleString()} likes, ${metadata.comments.toLocaleString()} comments\n`);

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
