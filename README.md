# YouTube Content Intelligence Skill

Claude Code skill for intelligent YouTube video analysis using Cloudflare Workers and CCW's Claude integration.

## Features

- **URL Parsing** - Extract video ID from various YouTube URL formats
- **Metadata Fetching** - Retrieve video metadata via Cloudflare Worker (views, likes, comments, duration)
- **Analysis Prompt Generation** - Create comprehensive analysis prompts for Claude
- **CCW Integration** - Uses your CCW subscription (no additional API costs)
- **Ultimate Content Intelligence v3.2** - 7-dimension analysis framework

## Quick Start

### 1. Deploy Cloudflare Worker

```bash
cd ~/projects/hex-yt-intel/worker
pnpm install
pnpm deploy
```

See [WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md) for detailed setup.

### 2. Run the Skill

```bash
cd ~/projects/hex-yt-intel
pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

### 3. Copy Output to Claude

The skill generates a formatted prompt. Copy the entire prompt output and paste it into Claude (Claude 3.5 Sonnet recommended) for comprehensive analysis.

## Architecture

### Three-Part System

```
1. SKILL (Local)
   ├─ Parse YouTube URL
   ├─ Extract video ID
   └─ Generate analysis prompt

2. WORKER (Cloudflare)
   ├─ Fetch from YouTube API
   └─ Return metadata

3. CLAUDE (Your Subscription)
   ├─ Analyze content
   └─ Generate intelligence report
```

### Why This Design?

- **No API credits needed** - Uses your CCW subscription
- **Transparent analysis** - You see what Claude analyzes
- **Customizable prompts** - Easy to adjust framework
- **Low latency** - Cloudflare Worker in 90+ countries
- **Cost-effective** - Free Cloudflare tier + existing Claude subscription

## Usage

### Basic Command

```bash
pnpm skill "YOUTUBE_URL"
```

### Supported URL Formats

```
https://www.youtube.com/watch?v=VIDEO_ID
https://youtu.be/VIDEO_ID
https://www.youtube.com/embed/VIDEO_ID
```

### Example

```bash
$ pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"

🎬 YouTube Content Intelligence Skill
=====================================

📍 Parsing YouTube URL...
✓ Video ID: M-uUFLU9IFU

🌐 Fetching metadata from Cloudflare Worker...
✓ Title: [Video Title]
✓ Channel: [Channel Name]
✓ Views: 245,000
✓ Engagement: 5,000 likes, 150 comments

📋 Generating analysis prompt for Claude...
✓ Prompt generated

=====================================
[Markdown prompt with metadata + analysis framework]
=====================================

✨ READY FOR CLAUDE ANALYSIS
Copy the prompt above and use it with Claude for comprehensive content intelligence analysis.
```

## Analysis Framework

### Ultimate Content Intelligence v3.2 (7 Dimensions)

The generated prompt requests analysis across:

1. **Content Structure & Flow**
   - Opening hook effectiveness
   - Narrative arc and pacing
   - Transition quality
   - Conclusion strength

2. **Audience Intelligence**
   - Target audience profile
   - Pain points addressed
   - Value proposition
   - Engagement signals

3. **Technical Execution**
   - Production quality
   - Audio/visual balance
   - Graphics effectiveness
   - Platform optimization

4. **Message Architecture**
   - Primary thesis
   - Supporting arguments
   - Social proof
   - Persuasion techniques
   - Call-to-action

5. **Performance Metrics Potential**
   - Viewer retention estimate
   - Engagement rate prediction
   - Viral potential (0-10)
   - Algorithm-friendly elements
   - Monetization opportunities

6. **Competitive Positioning**
   - Unique angle
   - Content gaps filled
   - Differentiation factors
   - Positioning effectiveness

7. **Actionable Insights**
   - Top 3 strengths to replicate
   - Top 3 improvement areas
   - Performance benchmarks
   - Content reuse opportunities
   - Cross-platform adaptation

## Installation

### Prerequisites

- Node.js 24+ (via `.nvmrc`)
- pnpm (package manager)
- Cloudflare account (free tier sufficient)
- YouTube API key (free from Google Cloud)

### Setup

```bash
# 1. Clone/navigate to project
cd ~/projects/hex-yt-intel

# 2. Use correct Node version
nvm use

# 3. Install dependencies
pnpm install

# 4. Deploy Worker (see WORKER_DEPLOYMENT.md)
cd worker && pnpm install && pnpm deploy && cd ..

# 5. Test the skill
pnpm skill "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## Configuration

### Environment Variables

Create `.env` file:
```bash
cp .env.example .env
```

Optional settings:
```
CLOUDFLARE_WORKER_URL=https://youtube-intelligence.workers.dev
```

### Cloudflare Worker

See [WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md) for:
- Getting YouTube API key
- Deploying worker
- Testing endpoints
- Monitoring performance

## Output Format

The skill generates a markdown prompt with:

```markdown
# YouTube Content Intelligence Report

## Video Metadata
- Title, Creator, Upload Date
- Duration, Views, Engagement

## Video Description
[Full description]

## Analysis Required
[7-dimension framework with specific questions]
[Instructions for Claude]
```

**To use:**
1. Run the skill
2. Copy the entire output (from "# YouTube..." to the end)
3. Paste into Claude
4. Claude returns formatted intelligence report

## Development

### Run Locally

```bash
pnpm dev
```

### Build TypeScript

```bash
pnpm build
```

### Test with Video

```bash
pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

### Worker Commands

```bash
pnpm worker:dev     # Local development
pnpm worker:build   # Build for production
pnpm worker:deploy  # Deploy to Cloudflare
```

## Troubleshooting

### "Invalid YouTube URL"
- Check format: `https://www.youtube.com/watch?v=VIDEO_ID`
- Video ID should be 11 alphanumeric characters

### "Worker returned 404"
- Worker not deployed: `cd worker && pnpm deploy`
- Wrong URL: Check `CLOUDFLARE_WORKER_URL` env var

### "Metadata unavailable"
- Video is private or deleted
- YouTube API rate limit exceeded (10K/day free)
- Internet connection issue

### "No analysis returned from Claude"
- Paste the prompt into Claude directly
- Ensure Claude session is active
- Try rephrasing if Claude misunderstands

## Performance

- **Skill execution**: <2 seconds
- **Worker latency**: 200-500ms (Cloudflare global network)
- **Total time-to-prompt**: ~1-3 seconds

## Cost Breakdown

| Component | Cost |
|-----------|------|
| Skill execution | Free (local) |
| Cloudflare Worker | Free (100K req/day) |
| YouTube API | Free (10K quota/day) |
| Claude analysis | Covered by CCW subscription |
| **Total per analysis** | **$0 (with subscription)** |

## Files

```
~/projects/hex-yt-intel/
├── skill/index.ts           # Main skill (parse + generate prompt)
├── worker/src/worker.ts     # Cloudflare Worker (fetch metadata)
├── worker/wrangler.toml     # Worker deployment config
├── README.md                # This file
├── WORKER_DEPLOYMENT.md     # Detailed Worker setup guide
├── EXAMPLE_OUTPUT.md        # Sample analysis report
└── SKILL_INTEGRATION.md     # Integration instructions
```

## Roadmap

- [ ] Batch video analysis
- [ ] Transcript fetching + analysis
- [ ] Competitor comparison
- [ ] SEO/algorithm scoring
- [ ] Engagement prediction
- [ ] Content calendar generation
- [ ] Multi-language support

## Support & Questions

1. **Skill usage**: See README.md or run `pnpm skill --help`
2. **Worker deployment**: See WORKER_DEPLOYMENT.md
3. **Analysis framework**: See EXAMPLE_OUTPUT.md
4. **Integration**: See SKILL_INTEGRATION.md

## License

MIT

## Author

CCW (Chief Cloud Architect)
