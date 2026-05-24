# Cloudflare Worker Secrets Deployment Guide

## Overview

The Cloudflare Worker (`yt-intel`) requires three secrets to be deployed for full functionality:
1. **YOUTUBE_API_KEY** — YouTube Data API credentials
2. **CLOUDFLARE_SECRET_TOKEN** — Internal authentication token
3. **RESIDENTIAL_PROXY_URL** — Bright Data proxy endpoint for transcript extraction fallback

These secrets must be deployed to the production environment via Wrangler CLI.

## Prerequisites

- Wrangler CLI v3+ installed globally: `npm install -g wrangler`
- Cloudflare account with API token access
- Valid credentials for each service

## Deployment Steps

### Step 1: Deploy YOUTUBE_API_KEY

```bash
wrangler secret put YOUTUBE_API_KEY --env production
# Paste your YouTube Data API key when prompted
```

**Where to get it**:
- Google Cloud Console → APIs & Services → YouTube Data API v3
- Create a service account or use existing OAuth credentials
- Format: Typically starts with `AIzaSy...`

### Step 2: Deploy CLOUDFLARE_SECRET_TOKEN

```bash
wrangler secret put CLOUDFLARE_SECRET_TOKEN --env production
# Paste your internal auth token when prompted
```

**What it is**:
- Custom authentication token for protecting worker endpoints
- Should be a strong random string (minimum 32 characters)
- Used to verify requests from your application

### Step 3: Deploy RESIDENTIAL_PROXY_URL

```bash
wrangler secret put RESIDENTIAL_PROXY_URL --env production
# When prompted, paste the full URL with credentials (see below)
```

**Current Value** (with authentication):
```
brd-customer-hl_da92bd7c-zone-yt_intel_prx1:qa0ffc1kewsa@brd.superproxy.io:33335
```

**Format Breakdown**:
- Username: `brd-customer-hl_da92bd7c-zone-yt_intel_prx1`
- Password: `qa0ffc1kewsa`
- Endpoint: `brd.superproxy.io:33335`

This is the Bright Data residential proxy URL extracted from:
```
curl --proxy brd.superproxy.io:33335 --proxy-user brd-customer-hl_da92bd7c-zone-yt_intel_prx1:qa0ffc1kewsa -k 'https://geo.brdtest.com/welcome.txt'
```

**Purpose**:
- Provides fallback routing for transcript extraction
- Bypasses IP-based rate limiting and geo-blocks
- Enables resilient content retrieval when direct access fails

## Verification

After deployment, verify secrets are accessible:

```bash
# List all secrets in production environment
wrangler secret list --env production
```

You should see:
- `YOUTUBE_API_KEY` ✓
- `CLOUDFLARE_SECRET_TOKEN` ✓
- `RESIDENTIAL_PROXY_URL` ✓

## Using Secrets in Worker Code

Secrets are passed to your handler function via the `env` parameter:

```typescript
export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const youtubeKey = env.YOUTUBE_API_KEY;
    const proxyUrl = env.RESIDENTIAL_PROXY_URL;
    const token = env.CLOUDFLARE_SECRET_TOKEN;
    
    // Use secrets in your worker logic
  },
};
```

## Environment Variables (Development)

For local development, secrets are read from `.wrangler/env` or the wrangler.toml config file. Add them to your development configuration:

```toml
[env.development]
vars = { ENVIRONMENT = "development" }
# Add secrets here for local testing (never commit real secrets!)
```

## Security Best Practices

1. **Never commit secrets** to Git or version control
2. **Rotate secrets regularly** (especially CLOUDFLARE_SECRET_TOKEN)
3. **Use strong random values** for custom tokens
4. **Verify API key scopes** in Google Cloud Console (restrict to YouTube API v3)
5. **Monitor usage** in Cloudflare Worker analytics dashboard

## Troubleshooting

### Secrets not found at runtime
- Ensure you deployed to the correct environment (`--env production`)
- Verify secrets exist with `wrangler secret list --env production`
- Check the worker function signature includes `env: Env` parameter

### Proxy connection fails
- Verify proxy endpoint format: `host:port` (currently `brd.superproxy.io:33335`)
- Test manually: `curl --proxy brd.superproxy.io:33335 https://example.com`
- Check Bright Data account credentials and quota

### API key errors
- Verify YouTube API is enabled in Google Cloud Console
- Check API quotas haven't been exceeded
- Ensure key has access to: `youtube.readonly` scope

## Related Documentation

- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [YouTube Data API Setup](https://developers.google.com/youtube/registering_an_application)
- [Bright Data Proxy Configuration](https://docs.brightdata.com/general/how-to-use-proxies)

---

**Last Updated**: 2026-05-24  
**Status**: Ready for deployment  
**Next Step**: Execute deployment commands in order
