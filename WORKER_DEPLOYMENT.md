# Cloudflare Worker Deployment Guide

## Overview

The skill uses a Cloudflare Worker to fetch YouTube video metadata. The Worker is deployed at:
```
https://youtube-intelligence.workers.dev
```

## Prerequisites

1. **Cloudflare Account** - Free tier is sufficient
2. **Wrangler CLI** - Cloudflare's deployment tool
3. **YouTube Data API Key** - For fetching video metadata

## Step 1: Get YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project: "YouTube Intelligence"
3. Enable the YouTube Data API v3
4. Create an API key (Credentials → API Key)
5. Copy the key (keep it secret!)

## Step 2: Install Wrangler

```bash
cd ~/projects/hex-yt-intel/worker
pnpm install
```

This installs:
- `wrangler` - Cloudflare deployment CLI
- `hono` - HTTP framework for the Worker
- `@cloudflare/workers-types` - TypeScript types

## Step 3: Configure Worker

### Edit `wrangler.toml`:

```toml
name = "youtube-intelligence"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[env.production]
routes = [
  { pattern = "youtube-intelligence.workers.dev/*" }
]
vars = { ENVIRONMENT = "production" }
```

### Set Environment Variables

Create `.env` file in `worker/` directory:
```bash
YOUTUBE_API_KEY=your_youtube_api_key_here
```

Or use Wrangler secrets:
```bash
cd worker
wrangler secret put YOUTUBE_API_KEY
# (paste your key, hit Enter twice)
```

## Step 4: Test Locally

```bash
cd ~/projects/hex-yt-intel/worker
pnpm dev
```

This starts a local Worker on `http://localhost:8787`

### Test the endpoint:

```bash
curl "http://localhost:8787/fetch-metadata?video_id=M-uUFLU9IFU"
```

Expected response:
```json
{
  "video_id": "M-uUFLU9IFU",
  "title": "Video Title",
  "description": "Full description...",
  "channel": "Channel Name",
  "duration": 860,
  "views": 245000,
  "likes": 5000,
  "comments": 150,
  "published_at": "2024-01-15T10:30:00Z",
  "thumbnail_url": "https://..."
}
```

## Step 5: Authenticate with Cloudflare

```bash
wrangler login
```

This opens a browser to authorize Cloudflare access.

## Step 6: Deploy Worker

```bash
cd ~/projects/hex-yt-intel/worker
pnpm deploy
```

Or use Wrangler directly:
```bash
wrangler deploy --env production
```

### Check Deployment:

```bash
# View deployments
wrangler deployments list

# Test the deployed endpoint
curl "https://youtube-intelligence.workers.dev/fetch-metadata?video_id=M-uUFLU9IFU"
```

## Step 7: Configure Skill

Once Worker is deployed, update the skill:

```bash
cd ~/projects/hex-yt-intel
export CLOUDFLARE_WORKER_URL="https://youtube-intelligence.workers.dev"
```

Or add to `.env`:
```
CLOUDFLARE_WORKER_URL=https://youtube-intelligence.workers.dev
```

## Testing the Skill

```bash
cd ~/projects/hex-yt-intel
pnpm skill "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

Expected output:
```
🎬 YouTube Content Intelligence Skill
=====================================

📍 Parsing YouTube URL...
✓ Video ID: M-uUFLU9IFU

🌐 Fetching metadata from Cloudflare Worker...
✓ Title: [Title]
✓ Channel: [Channel]
✓ Views: [Count]
✓ Engagement: [Likes], [Comments]

📋 Generating analysis prompt for Claude...
✓ Prompt generated

=====================================
# YouTube Content Intelligence Report
[Full analysis prompt...]
```

## Troubleshooting

### Error: "Worker not found" (404)

**Cause:** Worker not deployed yet or URL is wrong

**Fix:**
```bash
# Check deployment status
wrangler deployments list

# Redeploy
wrangler deploy --env production
```

### Error: "Unauthorized" (401)

**Cause:** Missing or invalid YOUTUBE_API_KEY

**Fix:**
```bash
# Update secret
wrangler secret put YOUTUBE_API_KEY
# (paste new key)

# Redeploy
wrangler deploy
```

### Error: "Video not found" (404)

**Cause:** Invalid video ID

**Fix:** Ensure video ID is 11 characters and the video is public

### Error: "Rate limited"

**Cause:** YouTube API rate limit exceeded

**Fix:** Implement backoff or wait 24 hours (free tier: 10K quota/day)

## Worker API Reference

### GET /fetch-metadata

**Parameters:**
- `video_id` (required) - 11-character YouTube video ID

**Response (200 OK):**
```json
{
  "video_id": "string",
  "title": "string",
  "description": "string",
  "channel": "string",
  "channel_id": "string",
  "duration": number,
  "views": number,
  "likes": number,
  "comments": number,
  "published_at": "ISO 8601 string",
  "thumbnail_url": "string"
}
```

**Error Responses:**
- `400` - Missing or invalid video_id
- `404` - Video not found
- `500` - Server error

### GET /

Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "message": "YouTube Intelligence Worker API",
  "endpoint": "/fetch-metadata?video_id=VIDEO_ID"
}
```

## Monitoring

### View Logs

```bash
# Real-time logs
wrangler tail

# Or through Cloudflare Dashboard:
# https://dash.cloudflare.com/ → Workers → youtube-intelligence → Logs
```

### Performance

- **Cold start:** ~50-100ms
- **Warm start:** ~10-20ms
- **API call:** ~200-500ms
- **Total latency:** ~250-600ms

### Cost

- **Free tier:** 100K requests/day (plenty for testing)
- **Paid tier:** $0.50/M requests after free tier
- **YouTube API:** 10K quota/day (free)

## Advanced: Custom Domain

To serve from a custom domain (e.g., `yt-intel.yourdomain.com`):

1. Add domain to Cloudflare
2. Update `wrangler.toml`:
```toml
[env.production]
routes = [
  { pattern = "yt-intel.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```
3. Deploy: `wrangler deploy --env production`

## Rollback

To revert to previous version:

```bash
# List deployments
wrangler deployments list

# Rollback to specific deployment
wrangler deployments rollback --message "Rollback to stable version"
```

## CI/CD Integration

For automated deployments (GitHub Actions):

```yaml
name: Deploy Worker
on:
  push:
    branches: [main]
    paths: [worker/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm -C worker deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
```

## Support

- [Wrangler Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [YouTube API Docs](https://developers.google.com/youtube/v3)
- [Hono Framework](https://hono.dev/)
