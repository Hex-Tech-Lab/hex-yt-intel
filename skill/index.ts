import Anthropic from "@anthropic-ai/sdk";

const CLOUDFLARE_WORKER_URL =
  "https://youtube-intelligence.workers.dev";

interface YouTubeMetadata {
  video_id: string;
  title: string;
  description: string;
  channel: string;
  duration: number;
  views: number;
  published_at: string;
  transcript?: string;
}

interface ContentIntelligenceReport {
  metadata: YouTubeMetadata;
  analysis: string;
}

const CONTENT_INTELLIGENCE_SYSTEM_PROMPT = `You are an advanced content intelligence analyst specializing in YouTube video analysis. Your role is to provide comprehensive, actionable intelligence on video content.

## Analysis Framework (Ultimate Content Intelligence v3.2)

### 1. CONTENT STRUCTURE & FLOW
- Opening hook effectiveness (0-10 scoring)
- Narrative arc and pacing
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
- Platform optimization (thumbnails, metadata)

### 4. MESSAGE ARCHITECTURE
- Primary message (main thesis)
- Supporting arguments (3-5 key points)
- Social proof and authority signals
- Emotional triggers and persuasion techniques
- Call-to-action strategy

### 5. PERFORMANCE METRICS POTENTIAL
- Estimated viewer retention curve
- Likely engagement rate (comments, shares)
- Viral potential (0-10 score)
- Algorithm-friendly elements
- Monetization opportunities

### 6. COMPETITIVE POSITIONING
- Unique angle vs. similar content
- Content gap it fills
- Differentiation factors
- Positioning effectiveness

### 7. ACTIONABLE INSIGHTS
- Top 3 strengths to replicate
- Top 3 improvement areas
- Benchmarks and comparisons
- Content reuse opportunities
- Cross-platform adaptation potential

## Output Format
Provide structured analysis with clear sections, quantitative scoring where applicable, and specific, actionable recommendations. Balance critical analysis with recognition of strengths.`;

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
      duration: data.duration || 0,
      views: data.views || 0,
      published_at: data.published_at || "Unknown Date",
      transcript: data.transcript || undefined,
    };
  } catch (error) {
    console.error(`Failed to fetch metadata for ${videoId}:`, error);
    // Return minimal metadata on failure
    return {
      video_id: videoId,
      title: "Metadata unavailable",
      description: "",
      channel: "Unknown",
      duration: 0,
      views: 0,
      published_at: "Unknown",
    };
  }
}

async function analyzeContent(
  metadata: YouTubeMetadata
): Promise<string> {
  const client = new Anthropic();

  const userMessage = `Analyze the following YouTube video using the Ultimate Content Intelligence v3.2 framework:

## Video Information
- **Title:** ${metadata.title}
- **Channel:** ${metadata.channel}
- **Published:** ${metadata.published_at}
- **Duration:** ${metadata.duration} seconds
- **Views:** ${metadata.views.toLocaleString()}

## Description
${metadata.description}

${metadata.transcript ? `## Transcript\n${metadata.transcript}` : ""}

Please provide a comprehensive content intelligence report covering all dimensions of the framework. Focus on actionable insights and specific recommendations.`;

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4000,
    system: CONTENT_INTELLIGENCE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return textContent.text;
}

function formatReport(
  metadata: YouTubeMetadata,
  analysis: string
): string {
  return `# YouTube Content Intelligence Report

## Video Metadata
- **Title:** ${metadata.title}
- **Channel:** ${metadata.channel}
- **Published:** ${metadata.published_at}
- **Duration:** ${Math.floor(metadata.duration / 60)} minutes ${metadata.duration % 60} seconds
- **Views:** ${metadata.views.toLocaleString()}
- **Video ID:** ${metadata.video_id}

## Description
${metadata.description}

---

## Content Analysis (Ultimate Content Intelligence v3.2)

${analysis}

---

*Report generated by YouTube Content Intelligence Skill*
*Analysis powered by Claude Sonnet 4*`;
}

async function main() {
  const youtubeUrl = process.argv[2];

  if (!youtubeUrl) {
    console.error("Usage: npx tsx skill/index.ts <YouTube URL>");
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
    console.log(`✓ Views: ${metadata.views.toLocaleString()}\n`);

    console.log("🤖 Analyzing content with Claude...");
    const analysis = await analyzeContent(metadata);
    console.log("✓ Analysis complete\n");

    console.log("📋 Generating report...");
    const report = formatReport(metadata, analysis);
    console.log("✓ Report generated\n");

    console.log("=====================================");
    console.log(report);
    console.log("=====================================\n");

    return {
      success: true,
      report,
      metadata,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${errorMessage}`);
    process.exit(1);
  }
}

main();
