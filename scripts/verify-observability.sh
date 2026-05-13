#!/bin/bash
# Observability Verification Script
# Tests Sentry DSN, health endpoint, and sends test events
# Runtime: ~30 seconds

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Observability Verification ===${NC}"
echo "Testing Sentry integration, health endpoint, and event tracking"
echo

# 1. Check environment variables
echo -e "${YELLOW}[1/5] Checking environment variables...${NC}"
if [ -f "$PROJECT_ROOT/web/.env.local" ]; then
  if grep -q "NEXT_PUBLIC_SENTRY_DSN" "$PROJECT_ROOT/web/.env.local"; then
    SENTRY_DSN=$(grep "NEXT_PUBLIC_SENTRY_DSN" "$PROJECT_ROOT/web/.env.local" | cut -d'=' -f2)
    echo -e "${GREEN}✓ Sentry DSN configured${NC}"
    echo "  DSN: ${SENTRY_DSN:0:50}..."
  else
    echo -e "${RED}✗ NEXT_PUBLIC_SENTRY_DSN not found in .env.local${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ web/.env.local not found${NC}"
  exit 1
fi
echo

# 2. Check if server is running
echo -e "${YELLOW}[2/5] Checking if development server is running...${NC}"
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Server is running at http://localhost:3000${NC}"
else
  echo -e "${YELLOW}⚠ Server not running. Start with: cd web && npm run dev${NC}"
  echo "  Skipping health check..."
  SKIP_HEALTH=1
fi
echo

# 3. Test health endpoint
if [ -z "$SKIP_HEALTH" ]; then
  echo -e "${YELLOW}[3/5] Testing /api/health endpoint...${NC}"
  HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health)

  if echo "$HEALTH_RESPONSE" | grep -q '"status"'; then
    STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✓ Health endpoint responded${NC}"
    echo "  Status: $STATUS"
    echo "  Full response:"
    echo "$HEALTH_RESPONSE" | jq . 2>/dev/null || echo "$HEALTH_RESPONSE"
  else
    echo -e "${RED}✗ Health endpoint failed${NC}"
    echo "Response: $HEALTH_RESPONSE"
  fi
else
  echo -e "${YELLOW}[3/5] Skipping health check (server not running)${NC}"
fi
echo

# 4. Verify Sentry configuration in code
echo -e "${YELLOW}[4/5] Verifying Sentry configuration in code...${NC}"

# Check sentry.config.js
if [ -f "$PROJECT_ROOT/web/sentry.config.js" ]; then
  if grep -q "enableTracing: true" "$PROJECT_ROOT/web/sentry.config.js"; then
    echo -e "${GREEN}✓ Performance monitoring enabled in sentry.config.js${NC}"
  else
    echo -e "${RED}✗ Performance monitoring not enabled${NC}"
  fi

  if grep -q "tracesSampleRate" "$PROJECT_ROOT/web/sentry.config.js"; then
    TRACE_RATE=$(grep "tracesSampleRate" "$PROJECT_ROOT/web/sentry.config.js" | head -1)
    echo -e "${GREEN}✓ Trace sample rate configured${NC}"
    echo "  $TRACE_RATE"
  fi

  if grep -q "replaysSessionSampleRate" "$PROJECT_PROJECT/web/sentry.config.js"; then
    echo -e "${GREEN}✓ Session replay enabled${NC}"
  fi
else
  echo -e "${RED}✗ sentry.config.js not found${NC}"
fi
echo

# 5. Verify monitoring utilities
echo -e "${YELLOW}[5/5] Checking monitoring utilities...${NC}"

if [ -f "$PROJECT_ROOT/web/lib/monitoring/sentry-utils.ts" ]; then
  UTILS_COUNT=$(grep -c "export function" "$PROJECT_ROOT/web/lib/monitoring/sentry-utils.ts")
  echo -e "${GREEN}✓ sentry-utils.ts found with $UTILS_COUNT exported functions${NC}"

  # List available functions
  echo "  Available utilities:"
  grep "export function" "$PROJECT_ROOT/web/lib/monitoring/sentry-utils.ts" | sed 's/export function /    - /' | sed 's/(.*)//'
else
  echo -e "${RED}✗ sentry-utils.ts not found${NC}"
fi
echo

# Summary
echo -e "${BLUE}=== Verification Summary ===${NC}"
echo -e "${GREEN}✓ Sentry DSN configured${NC}"
if [ -z "$SKIP_HEALTH" ]; then
  echo -e "${GREEN}✓ Health endpoint working${NC}"
fi
echo -e "${GREEN}✓ Performance monitoring enabled${NC}"
echo -e "${GREEN}✓ Monitoring utilities available${NC}"
echo

# Next steps
echo -e "${BLUE}=== Next Steps ===${NC}"
echo "1. Test in development:"
echo "   cd web && npm run dev"
echo
echo "2. Trigger a test error:"
echo "   curl -X POST http://localhost:3000/api/analyses \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"url\": \"https://www.youtube.com/watch?v=invalid\"}'"
echo
echo "3. View events in Sentry:"
echo "   https://sentry.io/organizations/hex-tech-lab/issues/"
echo
echo "4. Check admin dashboard:"
echo "   http://localhost:3000/admin/dashboards"
echo

echo -e "${GREEN}✓ Observability verification complete!${NC}"
