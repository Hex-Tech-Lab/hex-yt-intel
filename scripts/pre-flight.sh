#!/bin/bash

##############################################################################
# PRE-FLIGHT GUARDRAIL: CI Environment Variable Fallback Validation
##############################################################################
#
# CRITICAL RULE: Supabase client initialization must never fail in CI environments.
# This script enforces that fallback placeholders are in place before code is committed.
#
# Failures in this check indicate:
# 1. Next.js initialization may fail in GitHub Actions
# 2. WebServer won't start in Playwright tests
# 3. Pipeline Run will crash with timeout errors
#
# To disable this check (NOT RECOMMENDED), set: SKIP_PREFLIGHT=true
#
##############################################################################

set -e

if [ "$SKIP_PREFLIGHT" = "true" ]; then
  echo "⚠️  PREFLIGHT DISABLED (SKIP_PREFLIGHT=true)"
  exit 0
fi

echo "🛡️  Running pre-flight environment validation..."

# Check 1: Supabase client initialization has fallback placeholders
FILE="web/utils/supabase/client.ts"
if ! grep -q "placeholder-project.supabase.co" "$FILE"; then
  echo "❌ FAIL: Missing supabaseUrl fallback in $FILE"
  echo "   Add: const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';"
  exit 1
fi

if ! grep -q "placeholder-anon-key" "$FILE"; then
  echo "❌ FAIL: Missing supabaseKey fallback in $FILE"
  echo "   Add: const supabaseKey = ... || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder-anon-key';"
  exit 1
fi

# Check 2: Verify no real secrets are hardcoded
if grep -E "project\-[a-z0-9]{20}|eyJ[A-Za-z0-9_-]{100,}" "$FILE" | grep -v "placeholder" | grep -v "supabase.co"; then
  echo "⚠️  WARNING: Possible real credentials detected in $FILE"
  echo "   Verify these are NOT production secrets before committing."
fi

echo "✅ Pre-flight checks passed. Safe to commit."
exit 0
