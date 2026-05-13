#!/bin/bash
# sentry-setup-automation.sh
# Fully automated Sentry project creation + Next.js integration
# Usage: ./sentry-setup-automation.sh [sentry-auth-token] [vercel-token]

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Sentry Automation Setup ===${NC}\n"

# Check arguments
if [ -z "$1" ]; then
  echo -e "${RED}Error: Sentry auth token required${NC}"
  echo "Usage: ./sentry-setup-automation.sh [sentry-auth-token] [vercel-token]"
  echo ""
  echo "To get tokens:"
  echo "1. Sentry: https://sentry.io/settings/account/auth-tokens/"
  echo "2. Vercel: https://vercel.com/account/tokens"
  exit 1
fi

SENTRY_TOKEN="$1"
VERCEL_TOKEN="$2"

# Step 1: Create Sentry project via API
echo -e "${YELLOW}[1/7] Creating Sentry project...${NC}"

SENTRY_ORG="hex-tech-lab"
SENTRY_PROJECT="hex-yt-intel"
SENTRY_PLATFORM="nextjs"

SENTRY_RESPONSE=$(curl -s -X POST \
  https://sentry.io/api/0/organizations/${SENTRY_ORG}/projects/ \
  -H "Authorization: Bearer ${SENTRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'${SENTRY_PROJECT}'",
    "platform": "'${SENTRY_PLATFORM}'",
    "teams": ["'${SENTRY_ORG}'"]
  }')

# Extract DSN from response
SENTRY_DSN=$(echo "$SENTRY_RESPONSE" | grep -o '"dsn":"[^"]*' | cut -d'"' -f4)

# Check if project already exists
if echo "$SENTRY_RESPONSE" | grep -q "already exists"; then
  echo -e "${YELLOW}â Project already exists, getting DSN...${NC}"
  # Try to get DSN from existing project
  SENTRY_DSN=$(curl -s -X GET \
    https://sentry.io/api/0/organizations/${SENTRY_ORG}/projects/${SENTRY_PROJECT}/keys/ \
    -H "Authorization: Bearer ${SENTRY_TOKEN}" \
    -H "Content-Type: application/json" | grep -o '"dsn":"[^"]*' | head -1 | cut -d'"' -f4)
fi

if [ -z "$SENTRY_DSN" ]; then
  echo -e "${RED}Failed to create or get Sentry project${NC}"
  echo "Response: $SENTRY_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Sentry project ready${NC}"
echo "DSN: $SENTRY_DSN"

# Step 2: Update Vercel env var
if [ -n "$VERCEL_TOKEN" ]; then
  echo -e "${YELLOW}[2/7] Updating Vercel env var...${NC}"

  curl -s -X POST \
    https://api.vercel.com/v9/projects/hex-yt-intel/env \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
      "key": "NEXT_PUBLIC_SENTRY_DSN",
      "value": "'${SENTRY_DSN}'",
      "target": ["production"]
    }' > /dev/null

  echo -e "${GREEN}✓ Vercel env var updated${NC}"
else
  echo -e "${YELLOW}⚠ Skipping Vercel (no token provided)${NC}"
  echo "Manual: Add to Vercel Dashboard:"
  echo "  NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN"
fi

# Step 3: Update .env.local
echo -e "${YELLOW}[3/7] Updating .env.local...${NC}"

cd /home/kellyb_dev/projects/hex-yt-intel/web

# Add or update SENTRY_DSN
if grep -q "NEXT_PUBLIC_SENTRY_DSN" .env.local; then
  sed -i "s|^NEXT_PUBLIC_SENTRY_DSN=.*|NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN}|" .env.local
else
  echo "NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN}" >> .env.local
fi

echo -e "${GREEN}✓ .env.local updated${NC}"

# Step 4: Verify @sentry/nextjs is installed
echo -e "${YELLOW}[4/7] Checking @sentry/nextjs...${NC}"

if ! grep -q "@sentry/nextjs" package.json; then
  pnpm add @sentry/nextjs 2>&1 | tail -2
else
  echo -e "${GREEN}✓ @sentry/nextjs already installed${NC}"
fi

# Step 5: Verify sentry.config.js exists
echo -e "${YELLOW}[5/7] Verifying sentry.config.js...${NC}"

if [ -f "sentry.config.js" ]; then
  echo -e "${GREEN}✓ sentry.config.js exists${NC}"
else
  echo -e "${RED}✗ sentry.config.js missing${NC}"
  exit 1
fi

# Step 6: Verify next.config.ts
echo -e "${YELLOW}[6/7] Verifying next.config.ts...${NC}"

if grep -q "withSentryConfig" next.config.ts; then
  echo -e "${GREEN}✓ next.config.ts wrapped with Sentry${NC}"
else
  echo -e "${RED}✗ next.config.ts not wrapped${NC}"
  exit 1
fi

# Step 7: Verify setup
echo -e "${YELLOW}[7/7] Verifying TypeScript...${NC}"

if pnpm run type-check > /tmp/type-check.log 2>&1; then
  echo -e "${GREEN}✓ Type-check passed${NC}"
else
  echo -e "${RED}✗ Type-check had issues${NC}"
  cat /tmp/type-check.log
  exit 1
fi

# Summary
echo ""
echo -e "${GREEN}=== SENTRY SETUP COMPLETE ===${NC}"
echo ""
echo "✓ Sentry project: hex-yt-intel"
echo "✓ DSN: $SENTRY_DSN"
echo "✓ .env.local updated"
echo "✓ @sentry/nextjs installed"
echo "✓ sentry.config.js configured"
echo "✓ next.config.ts wrapped"
echo "✓ TypeScript verified"
echo ""
echo "📍 Next steps:"
echo "1. Commit changes"
echo "2. Verify Sentry dashboard"
echo "3. Test error page (http://localhost:3000/test-error)"
echo "4. Ready for Chunk 7"
echo ""
