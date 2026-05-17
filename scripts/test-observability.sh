#!/bin/bash
# Test observability endpoints and configurations
# Run this to verify all monitoring components are working

set -e

BASE_URL="${1:-http://localhost:3000}"
HEALTH_CHECK_ONLY="${2:-false}"

echo "=== hex-yt-intel Observability Test Suite ==="
echo "Base URL: $BASE_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

# Test function
test_endpoint() {
  local method=$1
  local endpoint=$2
  local expected_status=$3
  local description=$4

  echo -n "Testing: $description... "

  response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)

  if [ "$http_code" == "$expected_status" ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $http_code)"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}FAIL${NC} (Expected $expected_status, got $http_code)"
    fail_count=$((fail_count + 1))
    if [ ! -z "$body" ]; then
      echo "  Response: $body"
    fi
  fi
}

# Test 1: Health Check Endpoint
echo "--- Component 1: Health Check ---"
test_endpoint "GET" "/api/health" "200" "Health check endpoint returns 200"

response=$(curl -s "$BASE_URL/api/health")
if echo "$response" | grep -q '"status"'; then
  echo -e "${GREEN}✓${NC} Health check returns JSON with status"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}✗${NC} Health check response invalid"
  fail_count=$((fail_count + 1))
fi

if echo "$response" | grep -q '"components"'; then
  echo -e "${GREEN}✓${NC} Health check includes components"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}✗${NC} Health check missing components"
  fail_count=$((fail_count + 1))
fi

if [ "$HEALTH_CHECK_ONLY" == "true" ]; then
  echo ""
  echo "=== Test Summary ==="
  echo -e "Passed: ${GREEN}$pass_count${NC}"
  echo -e "Failed: ${RED}$fail_count${NC}"
  exit 0
fi

# Test 2: Sentry Configuration
echo ""
echo "--- Component 2: Sentry Configuration ---"

if [ -z "$NEXT_PUBLIC_SENTRY_DSN" ]; then
  echo -e "${YELLOW}!${NC} NEXT_PUBLIC_SENTRY_DSN not set in environment"
  echo "  Set this in .env.local to enable Sentry monitoring"
else
  echo -e "${GREEN}✓${NC} NEXT_PUBLIC_SENTRY_DSN is configured"
  pass_count=$((pass_count + 1))
fi

if [ -f "web/sentry.config.js" ]; then
  echo -e "${GREEN}✓${NC} sentry.config.js exists"
  pass_count=$((pass_count + 1))

  if grep -q "tracesSampleRate" "web/sentry.config.js"; then
    echo -e "${GREEN}✓${NC} Sentry tracing configured"
    pass_count=$((pass_count + 1))
  fi

  if grep -q "replaysSessionSampleRate" "web/sentry.config.js"; then
    echo -e "${GREEN}✓${NC} Sentry session replay configured"
    pass_count=$((pass_count + 1))
  fi
else
  echo -e "${RED}✗${NC} sentry.config.js not found"
  fail_count=$((fail_count + 1))
fi

# Test 3: Monitoring Utilities
echo ""
echo "--- Component 3: Monitoring Utilities ---"

if [ -f "web/lib/monitoring/sentry-utils.ts" ]; then
  echo -e "${GREEN}✓${NC} sentry-utils.ts exists"
  pass_count=$((pass_count + 1))

  if grep -q "trackAPIRequest" "web/lib/monitoring/sentry-utils.ts"; then
    echo -e "${GREEN}✓${NC} trackAPIRequest function available"
    pass_count=$((pass_count + 1))
  fi

  if grep -q "trackDatabaseQuery" "web/lib/monitoring/sentry-utils.ts"; then
    echo -e "${GREEN}✓${NC} trackDatabaseQuery function available"
    pass_count=$((pass_count + 1))
  fi

  if grep -q "trackExternalCall" "web/lib/monitoring/sentry-utils.ts"; then
    echo -e "${GREEN}✓${NC} trackExternalCall function available"
    pass_count=$((pass_count + 1))
  fi
else
  echo -e "${RED}✗${NC} sentry-utils.ts not found"
  fail_count=$((fail_count + 1))
fi

if [ -f "web/lib/monitoring/metrics.ts" ]; then
  echo -e "${GREEN}✓${NC} metrics.ts exists"
  pass_count=$((pass_count + 1))

  if grep -q "recordMetric" "web/lib/monitoring/metrics.ts"; then
    echo -e "${GREEN}✓${NC} recordMetric function available"
    pass_count=$((pass_count + 1))
  fi
else
  echo -e "${RED}✗${NC} metrics.ts not found"
  fail_count=$((fail_count + 1))
fi

# Test 4: Admin Dashboard
echo ""
echo "--- Component 4: Admin Dashboard ---"

if [ -f "web/app/admin/dashboards/page.tsx" ]; then
  echo -e "${GREEN}✓${NC} Admin dashboard page exists"
  pass_count=$((pass_count + 1))

  # Check if it's a Client Component
  if grep -q "'use client'" "web/app/admin/dashboards/page.tsx"; then
    echo -e "${GREEN}✓${NC} Dashboard is a client component"
    pass_count=$((pass_count + 1))
  fi
else
  echo -e "${RED}✗${NC} Admin dashboard page not found"
  fail_count=$((fail_count + 1))
fi

# Test 5: API Admin Stats
echo ""
echo "--- Component 5: Admin Stats API ---"

if [ -f "web/app/api/admin/stats/route.ts" ]; then
  echo -e "${GREEN}✓${NC} Admin stats endpoint exists"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}✗${NC} Admin stats endpoint not found"
  fail_count=$((fail_count + 1))
fi

# Test 6: Documentation
echo ""
echo "--- Component 6: Documentation ---"

if [ -f "docs/OBSERVABILITY.md" ]; then
  echo -e "${GREEN}✓${NC} OBSERVABILITY.md exists"
  pass_count=$((pass_count + 1))

  doc_size=$(wc -c < "docs/OBSERVABILITY.md")
  if [ "$doc_size" -gt 5000 ]; then
    echo -e "${GREEN}✓${NC} OBSERVABILITY.md is comprehensive (${doc_size} bytes)"
    pass_count=$((pass_count + 1))
  fi
else
  echo -e "${RED}✗${NC} OBSERVABILITY.md not found"
  fail_count=$((fail_count + 1))
fi

if [ -f "web/lib/monitoring/README.md" ]; then
  echo -e "${GREEN}✓${NC} Monitoring README.md exists"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}✗${NC} Monitoring README.md not found"
  fail_count=$((fail_count + 1))
fi

# Test 7: Instrumentation
echo ""
echo "--- Component 7: Instrumentation ---"

if [ -f "web/instrumentation.ts" ]; then
  echo -e "${GREEN}✓${NC} instrumentation.ts exists"
  pass_count=$((pass_count + 1))
else
  echo -e "${RED}✗${NC} instrumentation.ts not found"
  fail_count=$((fail_count + 1))
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}$pass_count${NC}"
echo -e "Failed: ${RED}$fail_count${NC}"

if [ $fail_count -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✓ All observability components are in place!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Set NEXT_PUBLIC_SENTRY_DSN in .env.local"
  echo "2. Start dev server: pnpm dev"
  echo "3. Visit admin dashboard: http://localhost:3000/admin/dashboards"
  echo "4. View health check: http://localhost:3000/api/health"
  echo "5. Check Sentry: https://sentry.io/"
  exit 0
else
  echo ""
  echo -e "${RED}✗ Some components are missing. Please check above.${NC}"
  exit 1
fi
