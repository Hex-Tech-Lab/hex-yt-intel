# Skill Integration Guide

## Installation as Claude Code Skill

### Step 1: Register the Skill

The skill is located at: `~/projects/hex-yt-intel/`

### Step 2: Configure Environment

Create `.env` file in project root:
```bash
cp .env.example .env
```

Add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-your-key-here
```

### Step 3: Deploy Cloudflare Worker

The skill requires a Cloudflare Worker endpoint for metadata fetching.

**Worker URL:** `https://youtube-intelligence.workers.dev`

**Cloudflare Worker Code (wrangler.toml):**
```toml
name = "youtube-intelligence"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[routes]]
pattern = "example.com/*"
zone_name = "example.com"
```

**Worker Implementation (src/index.ts):**
```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/fetch-metadata', async (c) => {
  const videoId = c.req.query('video_id')
  
  if (!videoId) {
    return c.json({ error: 'Missing video_id' }, 400)
  }
  
  try {
    // Fetch from YouTube Data API or use yt-dlp
    const metadata = await fetchYouTubeMetadata(videoId)
    return c.json(metadata)
  } catch (error) {
    return c.json({ error: 'Failed to fetch metadata' }, 500)
  }
})

export default app
```

### Step 4: Install Dependencies

```bash
cd ~/projects/hex-yt-intel
nvm use
pnpm install
```

### Step 5: Test the Skill

```bash
pnpm tsx skill/index.ts "https://www.youtube.com/watch?v=VIDEO_ID"
```

## Using in Claude Code

### Command Format

```
youtube-content-intelligence https://www.youtube.com/watch?v=M-uUFLU9IFU
```

### Expected Output

```
🎬 YouTube Content Intelligence Skill
=====================================

📍 Parsing YouTube URL...
✓ Video ID: M-uUFLU9IFU

🌐 Fetching metadata from Cloudflare Worker...
✓ Title: [Title]
✓ Channel: [Channel]
✓ Views: [Count]

🤖 Analyzing content with Claude...
✓ Analysis complete

📋 Generating report...
✓ Report generated

# YouTube Content Intelligence Report
[Detailed analysis following Ultimate Content Intelligence v3.2 framework]
```

## API Endpoints

### Cloudflare Worker Endpoints

#### GET /fetch-metadata

**Parameters:**
- `video_id` (required): 11-character YouTube video ID

**Response:**
```json
{
  "video_id": "M-uUFLU9IFU",
  "title": "Video Title",
  "description": "Full video description",
  "channel": "Channel Name",
  "duration": 860,
  "views": 245000,
  "published_at": "2024-01-15",
  "transcript": "Full video transcript (optional)"
}
```

## Troubleshooting

### Error: "Invalid YouTube URL"
- Ensure URL is in correct format
- Supported formats:
  - `https://www.youtube.com/watch?v=VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
  - `https://www.youtube.com/embed/VIDEO_ID`

### Error: "Worker returned 404"
- Cloudflare Worker not deployed
- Deploy worker using: `wrangler deploy`
- Verify URL: `https://youtube-intelligence.workers.dev`

### Error: "Credit balance too low"
- Add credits to Anthropic account at: https://console.anthropic.com/billing
- Verify API key is valid: `echo $ANTHROPIC_API_KEY`

### Error: "No text response from Claude"
- Check API rate limits
- Verify internet connection
- Try again with different video

## Performance & Costs

### Per-Analysis Cost
- **API Calls:** 1 Claude API call (Sonnet 4)
- **Tokens:** ~3,000-4,000 tokens per analysis
- **Cost:** ~$0.015 per analysis
- **With CCW Subscription:** Negligible cost

### Performance Metrics
- **URL Parsing:** <10ms
- **Metadata Fetch:** 500-1000ms
- **Claude Analysis:** 2-5 seconds
- **Total Time:** 3-7 seconds per video

## Advanced Usage

### Batch Analysis

To analyze multiple videos, create a script:

```bash
#!/bin/bash
VIDEOS=(
  "https://www.youtube.com/watch?v=VIDEO_ID_1"
  "https://www.youtube.com/watch?v=VIDEO_ID_2"
  "https://www.youtube.com/watch?v=VIDEO_ID_3"
)

for video in "${VIDEOS[@]}"; do
  echo "Analyzing: $video"
  pnpm tsx skill/index.ts "$video" > "report_$(date +%s).md"
  sleep 2  # Rate limiting
done
```

### Custom Framework

Modify the `CONTENT_INTELLIGENCE_SYSTEM_PROMPT` in `skill/index.ts` to:
- Change analysis dimensions
- Adjust scoring weights
- Add custom sections
- Tailor for specific content types

## Support

For issues or questions:
1. Check EXAMPLE_OUTPUT.md for sample output
2. Review README.md for detailed documentation
3. Check error messages for specific troubleshooting steps
4. Verify all dependencies are installed: `pnpm list`
