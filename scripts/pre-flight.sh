#!/bin/bash

##############################################################################
# PRE-FLIGHT GUARDRAIL: CI Environment Variable Fallback Validation
##############################################################################
#
# ZERO-FATAL POLICY: This script ensures that the codebase contains functional
# fallbacks for critical infrastructure components.
#
##############################################################################

set -e

# Support running from either root or package directories
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

if [ "$SKIP_PREFLIGHT" = "true" ]; then
  echo "⚠️  PREFLIGHT DISABLED (SKIP_PREFLIGHT=true)"
  exit 0
fi

echo "🛡️  Running pre-flight environment validation..."

# 1. Verify Quality Intelligence Engine (Non-blocking internal helper)
echo "🔍 Running Quality Intelligence Engine..."
pnpm exec tsx "$ROOT_DIR/scripts/verify-quality-engine.ts" || true

# 2. Run Production Environment Validator (Context-aware)
echo "🔍 Validating environment schema..."
node "$ROOT_DIR/scripts/validate-env.js"

echo "✅ Pre-flight checks passed. Safe to proceed."
exit 0
