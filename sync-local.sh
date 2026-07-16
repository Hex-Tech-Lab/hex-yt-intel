#!/bin/bash
# Post-merge sync script for hex-yt-intel
# Syncs local repository to latest main, updates dependencies, clears build artifacts

set -e

echo "🔄 Syncing hex-yt-intel to latest..."

# Fetch latest from origin
echo "📥 Fetching from origin..."
git fetch origin main

# Reset local main to origin/main
echo "🔄 Resetting to origin/main..."
git checkout main
git reset --hard origin/main

# Update pnpm if needed (matches package.json version)
echo "📦 Updating pnpm..."
pnpm install -g pnpm@11.9.0

# Install/update all dependencies
echo "📦 Installing dependencies..."
pnpm install

# Clear build artifacts
echo "🧹 Clearing build cache..."
rm -rf .next
rm -rf dist
rm -rf build
rm -rf coverage

# Verify TypeScript
echo "✔️ Type-checking..."
pnpm exec tsc --noEmit

echo ""
echo "✅ Sync complete!"
echo "   - Main branch: $(git rev-parse --short HEAD)"
echo "   - Dependencies: up-to-date"
echo "   - Build artifacts: cleared"
echo "   - Type check: passed"
echo ""
echo "Ready to develop. Next: 'pnpm dev' or 'pnpm test'"
