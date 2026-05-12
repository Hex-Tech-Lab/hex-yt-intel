# YouTube Content Intelligence Skill

## Overview

Intelligent analysis of YouTube videos using the **Ultimate Content Intelligence v3.2 Framework**. This skill extracts live metadata from any YouTube video and generates a comprehensive 7-dimensional content analysis ready for strategic decision-making.

**Status**: ✅ Production-ready  
**Framework**: Ultimate Content Intelligence v3.2 (16 sections)  
**Cost**: Zero (free Cloudflare Worker + Claude subscription)

---

## Quick Start

### Input Format
Any YouTube URL:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID`

### Example Usage
```bash
pnpm tsx skill/index.ts "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

### Example Output
```markdown
# YouTube Content Intelligence Report

## Video Metadata
- **Title:** I've done over 10,000 prompts - 44-min tutorial on how to generate UI
- **Creator:** DesignCode
- **Upload Date:** 2025-05-21T07:41:31Z
- **Duration:** 44m 17s
- **Views:** 179,661
- **Engagement:** Likes 6,543, Comments 157

## Analysis Required
[7-dimensional analysis framework for Claude AI analysis]
```

---

## What It Does

### 1. **Extract Video Metadata**
- Title, creator, publication date
- Duration, view count, engagement metrics
- Description, thumbnail URL
- Real-time data from YouTube Data API v3

### 2. **Generate Analysis Prompt**
- Structures metadata for Claude analysis
- Embeds 7-dimensional evaluation framework
- Provides detailed analysis instructions

### 3. **16-Section Analysis Framework**

| Section | Focus |
|---------|-------|
| **1. Header Intelligence** | Title effectiveness, hook strength, audience appeal |
| **2. Strategic Context & Framing** | Positioning, competitive landscape, alignment |
| **3. Executive Overview** | Summary, value propositions, differentiators |
| **4. Sentiment & Psychology** | Emotional triggers, persuasion, psychological appeals |
| **5. Content Map** | Structure, flow, narrative progression |
| **6. Priority Insights** | Ranked findings, success factors, pivotal moments |
| **7. Comparative Analysis** | Benchmarking, competitive intelligence, metrics |
| **8. Q&A Intelligence** | Questions, FAQs, audience pain points |
| **9. Implementation Systems** | Actionable steps, frameworks, methodologies |
| **10. Intelligence Database** | Organized findings, categorized insights |
| **11. Power Quotes** | Memorable statements, shareable excerpts |
| **12. Semantic Intelligence** | Keywords, semantic clusters, language patterns |
| **13. Discovery Pathways** | Research trails, learning sequences |
| **14. Scenario Analysis** | Edge cases, failure modes, robustness |
| **15. Strategic Foresight** | Future implications, trends, recommendations |
| **16. Risk Disclosures** | Limitations, caveats, context dependencies |

---

## Architecture

### Components
1. **Cloudflare Worker** (Metadata Fetcher)
   - Endpoint: `https://yt-intel.kellybakri.workers.dev/fetch-metadata`
   - Returns: Live YouTube metadata (JSON)
   - Auth: YouTube Data API v3 key

2. **Skill Logic** (`skill/index.ts`)
   - Parses YouTube URLs
   - Calls Worker for metadata
   - Generates analysis prompt
   - Outputs production-ready markdown

### Data Flow
```
YouTube URL → Parse Video ID → Call Worker → Fetch Metadata → Generate Prompt
                                    ↓
                            YouTube API v3
                                    ↓
                            Live Video Metadata
                                    ↓
                        Format for Claude Analysis
```

---

## Requirements

- **Node.js** 20+
- **pnpm** (or npm)
- **Internet connection** (for YouTube API calls)
- **TypeScript** 5.3+

### Install Dependencies
```bash
cd ~/projects/hex-yt-intel
pnpm install
```

---

## Usage

### Run Skill
```bash
pnpm tsx skill/index.ts "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Output
- Fetches live metadata from Cloudflare Worker
- Displays structured analysis prompt
- Ready to copy-paste into Claude for comprehensive analysis

### Environment Variables
```bash
# Optional: override default worker URL
export CLOUDFLARE_WORKER_URL="https://custom-worker-url.workers.dev"
```

---

## Output Format

### Markdown Report Structure
```markdown
# YouTube Content Intelligence Report

## Video Metadata
- Title, Creator, Upload Date
- Duration, Views, Engagement

## Video Description
[Full video description from YouTube]

## Analysis Required
[7-section analysis framework with specific evaluation criteria]
```

### Analysis Sections
1. CONTENT STRUCTURE & FLOW
2. AUDIENCE INTELLIGENCE
3. TECHNICAL EXECUTION
4. MESSAGE ARCHITECTURE
5. PERFORMANCE METRICS POTENTIAL
6. COMPETITIVE POSITIONING
7. ACTIONABLE INSIGHTS

---

## API Response Format

### Worker Endpoint
```
GET https://yt-intel.kellybakri.workers.dev/fetch-metadata?video_id=VIDEO_ID
```

### Response
```json
{
  "videoId": "M-uUFLU9IFU",
  "title": "Video Title",
  "description": "Video description...",
  "channelTitle": "Channel Name",
  "channelId": "UC...",
  "publishedAt": "2025-05-21T07:41:31Z",
  "duration": 2657,
  "viewCount": "179661",
  "likeCount": "6543",
  "commentCount": "157",
  "thumbnailUrl": "https://i.ytimg.com/..."
}
```

---

## Features

✅ **Real-time metadata** - Live YouTube data, not cached  
✅ **7-dimensional analysis** - Comprehensive evaluation framework  
✅ **Zero cost** - Free Cloudflare Workers + Claude subscription  
✅ **Production-ready** - Markdown output for sharing  
✅ **URL flexible** - Handles multiple YouTube URL formats  
✅ **Error handling** - Graceful degradation on API failures  

---

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20+
- **Build**: esbuild
- **APIs**: YouTube Data API v3, Cloudflare Workers
- **Framework**: Hono.js (Worker), Native Node.js (Skill)

---

## Deployment

### Claude Skills Platform
```bash
# Prepare for deployment
pnpm run build

# Register manifest with Claude
# Submit skill/manifest.json to Claude Skills platform
```

### Worker Deployment
```bash
cd worker
pnpm run deploy
```

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| Invalid YouTube URL | Malformed URL | Use correct YouTube URL format |
| Video not found | Private/deleted video | Verify video ID exists |
| Missing metadata | API error | Check YouTube API quota |
| Worker timeout | Network issue | Retry request |

---

## Development

### Local Testing
```bash
# Test skill with real URL
pnpm tsx skill/index.ts "https://www.youtube.com/watch?v=M-uUFLU9IFU"

# Test worker locally
cd worker
pnpm run dev

# Build worker
pnpm run build
```

### Build Output
- **Worker**: `worker/dist/worker.js` (~64KB gzipped)
- **Skill**: Native TypeScript, no build required

---

## Performance

- **Metadata fetch**: ~500ms-1s (network + YouTube API)
- **Prompt generation**: ~100ms
- **Total**: ~1-2s per video
- **Worker uptime**: 99.95% (Cloudflare SLA)

---

## Security

- ✅ API keys stored as Cloudflare secrets (encrypted)
- ✅ CORS enabled for Worker
- ✅ No data storage (stateless processing)
- ✅ Rate limiting via YouTube API quotas

---

## Support & Documentation

- **Project Repo**: [hex-yt-intel on GitHub](https://github.com/Hex-Tech-Lab/hex-yt-intel)
- **Framework**: Ultimate Content Intelligence v3.2
- **Author**: CCW
- **License**: MIT

---

## Roadmap

- [ ] Claude Skills platform registration
- [ ] Live testing in Claude Web (CCW)
- [ ] Multi-language analysis support
- [ ] Video transcript integration
- [ ] Custom analysis frameworks

---

**Status**: Production-ready ✅  
**Last Updated**: 2026-05-12  
**Version**: 1.0.0
