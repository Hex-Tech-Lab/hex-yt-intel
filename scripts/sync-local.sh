#!/bin/bash
# Self-running local sync script
# Syncs your laptop with latest remote changes and keeps you up to date
# Run: chmod +x scripts/sync-local.sh && ./scripts/sync-local.sh

set -e
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${REPO_ROOT}/.sync-log"
BRANCH=${1:-"main"}  # Default to main, or pass branch name

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'  # No Color

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_step() {
  echo -e "${BLUE}=== $* ===${NC}" | tee -a "$LOG_FILE"
}

log_success() {
  echo -e "${GREEN}✓ $*${NC}" | tee -a "$LOG_FILE"
}

log_warning() {
  echo -e "${YELLOW}⚠ $*${NC}" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}✗ $*${NC}" | tee -a "$LOG_FILE"
}

# Check if we're in a git repo
if [ ! -d "$REPO_ROOT/.git" ]; then
  log_error "Not in a git repository. Aborting."
  exit 1
fi

cd "$REPO_ROOT"

log_step "Starting local sync"

# Stage 1: Check for uncommitted changes
log_step "Stage 1: Checking for uncommitted changes"
if [ -n "$(git status --porcelain)" ]; then
  log_warning "Uncommitted changes detected:"
  git status --short | tee -a "$LOG_FILE"
  log "Stashing changes..."
  git stash push -m "Auto-stash before sync at $(date '+%Y-%m-%d %H:%M:%S')"
  log_success "Changes stashed"
  STASHED=true
else
  log_success "Working tree clean"
  STASHED=false
fi

# Stage 2: Fetch remote changes
log_step "Stage 2: Fetching remote changes"
if git fetch origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
  log_success "Fetch successful"
else
  log_error "Fetch failed"
  exit 1
fi

# Stage 3: Check current branch
log_step "Stage 3: Checking current branch"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
log "Current branch: $CURRENT_BRANCH (target: $BRANCH)"

if [ "$CURRENT_BRANCH" = "$BRANCH" ]; then
  log "Pulling latest changes..."
  if git pull origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    log_success "Pull successful"
  else
    log_error "Pull failed - merge conflict or network issue"
    exit 1
  fi
else
  log "Switching to $BRANCH..."
  git checkout "$BRANCH" 2>&1 | tee -a "$LOG_FILE"
  git pull origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"
  log_success "Switched and pulled $BRANCH"
fi

# Stage 4: Install dependencies
log_step "Stage 4: Installing dependencies"
if command -v pnpm &> /dev/null; then
  if pnpm install 2>&1 | tee -a "$LOG_FILE"; then
    log_success "Dependencies installed"
  else
    log_warning "Dependency install had issues"
  fi
else
  log_warning "pnpm not found, skipping install"
fi

# Stage 5: Type check and lint (optional, non-blocking)
log_step "Stage 5: Running quality checks (non-blocking)"
if [ -f "web/package.json" ]; then
  cd web

  if pnpm type-check 2>&1 | tee -a "$LOG_FILE"; then
    log_success "Type check passed"
  else
    log_warning "Type check failed - see logs"
  fi

  cd "$REPO_ROOT"
fi

# Stage 6: Show sync summary
log_step "Stage 6: Sync summary"
log "Commits behind remote:"
git log --oneline "$BRANCH"..origin/"$BRANCH" 2>/dev/null | wc -l | xargs echo "  - " | tee -a "$LOG_FILE"

log "Latest commit:"
git log -1 --oneline | tee -a "$LOG_FILE"

# Stage 7: Restore stashed changes if any
if [ "$STASHED" = true ]; then
  log_step "Stage 7: Restoring stashed changes"
  if git stash pop 2>&1 | tee -a "$LOG_FILE"; then
    log_success "Stashed changes restored"
  else
    log_warning "Stash pop had conflicts - manual review needed"
    log "Stash list:"
    git stash list | tee -a "$LOG_FILE"
  fi
fi

log_success "Sync complete!"
log "Log saved to: $LOG_FILE"
