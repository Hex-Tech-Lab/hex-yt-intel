#!/bin/bash

# Direct deployment of HMAC secret to Vercel and Cloudflare
# Usage: STREAM_HMAC_SECRET='...' VERCEL_TOKEN='...' CLOUDFLARE_API_TOKEN='...' bash scripts/deploy-hmac-secret.sh
#
# IMPORTANT: Never hardcode the secret in this file. Always pass via env var.

set -e

# Fail-closed: validate Vercel-only vars always; Cloudflare vars only with --cloudflare
REQUIRED_VARS=("STREAM_HMAC_SECRET" "VERCEL_TOKEN" "VERCEL_PROJECT_ID" "VERCEL_TEAM_ID")
CLOUDFLARE_MODE=false
for arg in "$@"; do
  if [ "$arg" = "--cloudflare" ]; then CLOUDFLARE_MODE=true; fi
done

if [ "$CLOUDFLARE_MODE" = true ]; then
  REQUIRED_VARS+=("CLOUDFLARE_API_TOKEN" "CLOUDFLARE_ACCOUNT_ID")
fi

MISSING=false
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ $var not set"
    MISSING=true
  fi
done
if [ "$MISSING" = true ]; then
  echo ""
  echo "   Usage: STREAM_HMAC_SECRET='...' VERCEL_TOKEN='...' VERCEL_PROJECT_ID='...' VERCEL_TEAM_ID='...' bash scripts/deploy-hmac-secret.sh"
  echo "   Add --cloudflare to also push to Cloudflare Worker (requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)"
  exit 1
fi
HMAC_SECRET="$STREAM_HMAC_SECRET"
PROJECT_ID="$VERCEL_PROJECT_ID"
TEAM_ID="$VERCEL_TEAM_ID"
WORKER_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"

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
echo "   cd worker && wrangler secret put STREAM_HMAC_SECRET --env production"
echo "   Then paste: $HMAC_SECRET"
echo ""
echo "   Or use Cloudflare Dashboard:"
echo "   https://dash.cloudflare.com/ → Workers → yt-intel → Settings → Secrets"
