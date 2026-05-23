#!/bin/bash

##############################################################################
# Production Verification Test Runner
#
# Runs Playwright tests that verify frontend rendering, client environment
# strings, and auth page security. Tests the actual rendered HTML to catch
# hydration mismatches and empty environment variable inlining.
#
# Usage:
#   ./scripts/run-production-verification.sh
#   ./scripts/run-production-verification.sh https://staging.example.com
#   ./scripts/run-production-verification.sh --headed
##############################################################################

set -euo pipefail

DEPLOYMENT_URL="${1:-https://hex-yt-intel.vercel.app}"
HEADED_MODE=""

# Handle URL vs flag argument
if [[ "$DEPLOYMENT_URL" == "--headed" ]]; then
  HEADED_MODE="--headed"
  DEPLOYMENT_URL="https://hex-yt-intel.vercel.app"
elif [[ "${2:-}" == "--headed" ]]; then
  HEADED_MODE="--headed"
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Production Frontend Verification (Playwright)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Deployment URL: $DEPLOYMENT_URL"
echo "Test Mode: $HEADED_MODE"
echo ""

# Check if pnpm or npx is available
if command -v pnpm &> /dev/null; then
  PKG_RUNNER="pnpm exec"
elif command -v npx &> /dev/null; then
  PKG_RUNNER="npx"
else
  echo -e "${RED}✗ Neither pnpm nor npx found - unable to run Playwright tests${NC}"
  exit 1
fi

# Check if web directory exists
if [ ! -d "web" ]; then
  echo -e "${RED}✗ web directory not found - run from project root${NC}"
  exit 1
fi

echo -e "${YELLOW}Installing Playwright browsers if needed...${NC}"
$PKG_RUNNER playwright install --with-deps > /dev/null 2>&1 || true

echo ""
echo -e "${YELLOW}Running production verification tests...${NC}"
echo ""

# Run the tests with the deployment URL
export DEPLOYMENT_URL
cd web

# Run Playwright test
$PKG_RUNNER playwright test tests/production-verification.spec.ts $HEADED_MODE --reporter=line

TEST_RESULT=$?

cd ..

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

if [ $TEST_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ All production verification tests passed${NC}"
  echo ""
  echo "Verified:"
  echo "  • Frontend renders without hydration errors"
  echo "  • Client environment strings are materialized"
  echo "  • Auth pages are secure (no config leaks)"
  echo "  • API health endpoint is operational"
  echo "  • No uninitialized environment variables"
  echo ""
  exit 0
else
  echo -e "${RED}✗ Production verification tests failed${NC}"
  echo ""
  echo "Run with --headed flag for debug mode:"
  echo "  ./scripts/run-production-verification.sh $DEPLOYMENT_URL --headed"
  echo ""
  exit 1
fi
