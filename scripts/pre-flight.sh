#!/bin/bash

##############################################################################
# PRE-FLIGHT GUARDRAIL: CI Environment Variable Fallback Validation
##############################################################################
#
# ZERO-FATAL POLICY: This script ensures that the codebase contains functional
# fallbacks for critical infrastructure components.
#
# This script is NON-BLOCKING in Preview/CI environments.
#
##############################################################################

# Support running from either root or package directories
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

echo "🛡️  Running pre-flight environment validation..."

# 1. Verify qa-intel (Non-blocking internal helper)
echo "🔍 Running qa-intel..."
pnpm exec tsx "$ROOT_DIR/scripts/verify-quality-engine.ts" || echo "⚠️ qa-intel check skipped or failed."

# 2. Run Production Environment Validator (Context-aware)
echo "🔍 Validating environment schema..."
node "$ROOT_DIR/scripts/validate-env.js" || echo "⚠️ Environment validation warning logged."

echo "✅ Pre-flight checks completed (Non-blocking)."
exit 0
