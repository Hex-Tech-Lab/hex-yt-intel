---
Filename: VERCEL_ENV_SETUP.md
Location: /docs/ops/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: VERCEL ENV SETUP
---

# Vercel Environment Variables - Manual Setup Required

## Critical Issue
The Vercel deployment is missing Supabase environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

This causes the health check to show "degraded" status.

## Solution

### Step 1: Go to Vercel Dashboard
https://vercel.com/hex-tech-lab/hex-yt-intel/settings/environment-variables

### Step 2: Add Production Variables

**Variable 1:**
- Name: `NEXT_PUBLIC_SUPABASE_URL`
- Value: `https://adnmbikaqnxivalqoild.supabase.co`
- Environment: Production ✓

**Variable 2:**
- Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Value: (see below)
- Environment: Production ✓

The anon key is in this repository (web/.env.local).

### Step 3: Redeploy
After setting the variables:
1. Go to Vercel Deployments page
2. Click "Redeploy" on the latest deployment
3. Wait for build to complete

### Step 4: Verify
```bash
curl https://hex-yt-intel.vercel.app/api/health
# Should return: "status": "ok" (not "degraded")
```

## Why This Happened
- Vercel CLI is non-functional in this environment
- Environment variables must be set via Vercel Dashboard
- Next.js build-time uses placeholders, runtime needs actual values

## Alternative: Using Vercel API
If you have `VERCEL_TOKEN`, we can set these programmatically.
