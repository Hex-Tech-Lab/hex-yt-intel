#!/bin/bash

# Direct deployment of HMAC secret to Vercel and Cloudflare
# Usage: VERCEL_TOKEN='...' CLOUDFLARE_API_TOKEN='...' bash scripts/deploy-hmac-secret.sh

set -e

HMAC_SECRET="SSqdnev979rW2Z2b/x2J7UQ8/Veo1HfA21WU6L8elqU="
PROJECT_ID="prj_jKAo3z8jKyHwi3qXqSIeoZO1ILku"
TEAM_ID="team_vgnBI2s3ynPBzQdOLqhGvBnK"
WORKER_ACCOUNT_ID="your-cloudflare-account-id"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Deploying HMAC Secret to Production"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Validate tokens
if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN not set"
  exit 1
fi

echo ""
echo "📋 Step 1: Deploying to Vercel Production..."

# Update environment variable via Vercel API
VERCEL_RESPONSE=$(curl -s -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"key\": \"STREAM_HMAC_SECRET\",
    \"value\": \"$HMAC_SECRET\",
    \"target\": [\"production\", \"preview\"],
    \"type\": \"encrypted\"
  }")

echo "$VERCEL_RESPONSE" | jq . 2>/dev/null || echo "$VERCEL_RESPONSE"

echo ""
echo "📋 Step 2: Triggering Vercel Production Redeploy..."

# Trigger redeploy
DEPLOY_RESPONSE=$(curl -s -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"hex-yt-intel\",
    \"gitSource\": {
      \"ref\": \"main\",
      \"repoId\": \"techhypexps/hex-yt-intel\"
    }
  }")

DEPLOYMENT_ID=$(echo "$DEPLOY_RESPONSE" | jq -r '.id // empty')

if [ -n "$DEPLOYMENT_ID" ]; then
  echo "✅ Deployment triggered: $DEPLOYMENT_ID"
  echo "   Monitor at: https://vercel.com/techhypexps-projects/hex-yt-intel/deployments/$DEPLOYMENT_ID"
else
  echo "❌ Deployment failed:"
  echo "$DEPLOY_RESPONSE" | jq .
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Vercel deployment initiated"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Step 3: For Cloudflare Worker, run:"
echo "   wrangler secret put STREAM_HMAC_SECRET --env production"
echo "   Then paste: $HMAC_SECRET"
echo ""
echo "   Or use Cloudflare Dashboard:"
echo "   https://dash.cloudflare.com/ → Workers → yt-intel → Settings → Secrets"
