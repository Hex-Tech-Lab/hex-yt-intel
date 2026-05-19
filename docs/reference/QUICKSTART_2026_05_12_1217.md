---
Filename: QUICKSTART.md
Location: /docs/reference/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: QUICKSTART
---

# YouTube Content Intelligence - Quick Start Guide

## 3-Step Setup (15 minutes)

### Step 1: Get YouTube API Key (5 minutes)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project: **YouTube Intelligence**
3. Search for "YouTube Data API v3" → Click "Enable"
4. Go to Credentials → Create API Key
5. Copy the key (e.g., `AIzaSy...`)

### Step 2: Deploy Cloudflare Worker (5 minutes)

```bash
cd ~/projects/hex-yt-intel/worker

# Install dependencies
pnpm install

# Login to Cloudflare
wrangler login
# (opens browser, click Authorize, return to terminal)

# Set YouTube API key
wrangler secret put YOUTUBE_API_KEY
# (paste your key from Step 1, press Enter twice)

# Deploy
wrangler deploy
```

**Output:**
```
✨ Successfully published your Worker to
   https://youtube-intelligence.workers.dev
```

**Test it:**
```bash
curl "https://youtube-intelligence.workers.dev/fetch-metadata?video_id=M-uUFLU9IFU"
```

Should return JSON with video metadata.

### Step 3: Run the Skill (5 minutes)

```bash
cd ~/projects/hex-yt-intel

# Run with any YouTube URL
pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

**Output:**
```
🎬 YouTube Content Intelligence Skill
=====================================

📍 Parsing YouTube URL...
✓ Video ID: M-uUFLU9IFU

🌐 Fetching metadata from Cloudflare Worker...
✓ Title: [Video Title]
✓ Channel: [Creator Name]
✓ Views: [Count]
✓ Engagement: [Likes], [Comments]

📋 Generating analysis prompt for Claude...
✓ Prompt generated

=====================================
# YouTube Content Intelligence Report
[Full analysis prompt with metadata]
=====================================

✨ READY FOR CLAUDE ANALYSIS
```

## Using the Output

The skill generates a **markdown prompt** ready for Claude:

1. **Copy** the entire output (from `# YouTube Content Intelligence Report` to the end)
2. **Paste** into Claude (Claude 3.5 Sonnet recommended)
3. **Claude analyzes** using the Ultimate Content Intelligence v3.2 framework
4. **Get report** with 7-dimension analysis + actionable insights

## Example Workflow

```bash
# Terminal 1: Run skill
$ pnpm skill "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
# [outputs prompt]

# Terminal 2: Copy prompt into Claude
# (use Claude web, desktop app, or VS Code extension)
# Paste prompt → Claude returns detailed analysis

# Repeat for other videos
```

## Common Issues

### "Cloudflare not authenticated"
```bash
wrangler login
# (opens browser, authorize, return to terminal)
```

### "YOUTUBE_API_KEY not set"
```bash
wrangler secret put YOUTUBE_API_KEY
# (paste key, press Enter twice)
wrangler deploy
```

### "Worker returns 404"
- Wait 30 seconds for deployment to propagate
- Check: `https://youtube-intelligence.workers.dev/`
- Should show: `{"status":"ok",...}`

### "Metadata unavailable"
- Video is private, deleted, or age-restricted
- YouTube API rate limit (10K/day free)
- Check Worker logs: `wrangler tail`

## Architecture Summary

```
You Type URL
    ↓ (Terminal)
Skill parses & fetches metadata
    ↓ (calls Worker)
Worker calls YouTube API
    ↓ (Cloudflare global network)
Skill generates analysis prompt
    ↓ (markdown format)
You paste into Claude
    ↓ (Claude web/app/IDE)
Claude returns intelligence report
    ↓
Get actionable insights
```

## What You Get

**Per video:**
- Metadata: Title, creator, views, engagement
- Structure analysis: Hook, pacing, transitions, conclusion
- Audience profile: Target, pain points, value prop
- Technical execution: Quality, audio/visual, optimization
- Message architecture: Thesis, arguments, persuasion
- Performance potential: Retention, engagement, viral score
- Competitive positioning: Unique angle, gaps, differentiation
- Actionable insights: Strengths, improvements, content reuse

## Next Steps

1. **Deploy Worker** (Step 2) - takes 5 minutes
2. **Run skill** (Step 3) - instant
3. **Analyze videos** - unlimited with CCW subscription

## Support

| Issue | Solution |
|-------|----------|
| Need Worker setup help | See [WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md) |
| Want to customize prompt | Edit `skill/index.ts` `formatAnalysisPrompt()` |
| Need analysis examples | See [EXAMPLE_OUTPUT.md](EXAMPLE_OUTPUT.md) |
| Troubleshooting | See [README.md](README.md) Troubleshooting section |

## Cost

- ✅ Cloudflare Worker: Free (100K requests/day)
- ✅ YouTube API: Free (10K quota/day)
- ✅ Claude analysis: Covered by CCW subscription
- **Total: $0**

---

**You're ready! Run the skill now:**

```bash
cd ~/projects/hex-yt-intel
pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```
