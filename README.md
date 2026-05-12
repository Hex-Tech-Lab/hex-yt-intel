# YouTube Content Intelligence Skill

Claude Code skill for intelligent YouTube video analysis using Cloudflare Workers and the Anthropic Claude API.

## Features

- **URL Parsing**: Extract video ID from various YouTube URL formats
- **Metadata Fetching**: Retrieve video metadata via Cloudflare Worker
- **Content Analysis**: Comprehensive video analysis using Ultimate Content Intelligence v3.2 framework
- **Structured Reporting**: Formatted markdown reports with actionable insights

## Installation

```bash
cd ~/projects/hex-yt-intel
nvm use
pnpm install
```

## Usage

### Command Line

```bash
npx tsx skill/index.ts "https://www.youtube.com/watch?v=VIDEO_ID"
```

### In Claude Code Skill

```bash
youtube-content-intelligence https://www.youtube.com/watch?v=M-uUFLU9IFU
```

## Configuration

1. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

2. Add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-...
```

## Architecture

### Components

1. **URL Parser**: Validates and extracts video ID from YouTube URLs
   - Supports: youtube.com, youtu.be, embed URLs

2. **Metadata Fetcher**: Calls Cloudflare Worker endpoint
   - Returns: Title, description, channel, duration, views, published date, transcript

3. **Content Analyzer**: Uses Claude Sonnet 4
   - System prompt: Ultimate Content Intelligence v3.2
   - Analysis depth: 7 dimensions
   - Output: Structured intelligence report

4. **Report Formatter**: Generates markdown output
   - Sections: Metadata, Description, Analysis
   - Markdown-formatted for easy sharing

### Data Flow

```
YouTube URL
    ↓
Parse Video ID
    ↓
Fetch Metadata (Cloudflare Worker)
    ↓
Analyze Content (Claude API)
    ↓
Format & Return Markdown Report
```

## Analysis Framework

### Ultimate Content Intelligence v3.2

The skill analyzes videos across 7 dimensions:

1. **Content Structure & Flow** - Hook effectiveness, narrative arc, pacing
2. **Audience Intelligence** - Target profile, pain points, value proposition
3. **Technical Execution** - Production quality, audio/visual, optimization
4. **Message Architecture** - Primary thesis, supporting arguments, persuasion
5. **Performance Metrics Potential** - Retention, engagement, viral potential
6. **Competitive Positioning** - Unique angle, differentiation, benchmarks
7. **Actionable Insights** - Strengths, improvements, reuse opportunities

Each dimension includes quantitative scoring (0-10 scale) and specific recommendations.

## Output Example

```markdown
# YouTube Content Intelligence Report

## Video Metadata
- **Title:** [Title]
- **Channel:** [Channel]
- **Views:** [Count]
- **Duration:** [Time]

## Content Analysis
[Comprehensive analysis across 7 dimensions]
[Quantitative scores]
[Actionable recommendations]
```

## Development

### Run Locally

```bash
pnpm dev
```

### Build TypeScript

```bash
pnpm build
```

### Test with Sample URL

```bash
npx tsx skill/index.ts "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

## Dependencies

- **@anthropic-ai/sdk** - Claude API client
- **TypeScript** - Language and tooling
- **tsx** - TypeScript execution

## API Keys Required

- `ANTHROPIC_API_KEY` - For Claude API access (required)
- Cloudflare Worker - Pre-deployed (no key needed)

## Troubleshooting

### "Invalid YouTube URL"
- Ensure URL is in one of these formats:
  - `https://www.youtube.com/watch?v=VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
  - `https://www.youtube.com/embed/VIDEO_ID`

### "Worker returned 404"
- Verify Cloudflare Worker is deployed
- Check URL: `https://youtube-intelligence.workers.dev`

### "No text response from Claude"
- Verify `ANTHROPIC_API_KEY` is set
- Check API rate limits

## Cost Estimation

- **Claude API**: ~$0.015 per analysis (Sonnet 4, 4000 tokens)
- **Cloudflare Worker**: Free tier (1M requests/month)

**Total cost per analysis**: ~$0.015 (negligible with CCW subscription)

## Roadmap

- [ ] Transcript fetching from YouTube Captions API
- [ ] Batch analysis for multiple videos
- [ ] Sentiment analysis integration
- [ ] Competitor analysis comparison
- [ ] SEO/discoverability scoring
- [ ] Engagement prediction modeling
- [ ] Content calendar recommendations

## License

MIT

## Author

CCW (Chief Cloud Architect)
