#!/usr/bin/env bash
# Autonomous Review Loop — Chunks 9-12
# Runs every 15 minutes; logs to review-loop.log

REPO="/home/kellyb_dev/projects/hex-yt-intel"
LOG="/home/kellyb_dev/projects/hex-yt-intel/review-loop.log"
INTERVAL=900

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

log "=== AUTONOMOUS REVIEW LOOP STARTED ==="
log "Monitoring: pr9-chunk9-pdf-share, pr10-stripe-integration, pr11-queue-cache-tests, pr12-vercel-deploy"
log "Interval: ${INTERVAL}s (15 min)"

while true; do
  log ""
  log "=== TICK START ==="

  for branch in pr9-chunk9-pdf-share pr10-stripe-integration pr11-queue-cache-tests pr12-vercel-deploy; do
    log "--- $branch ---"
    cd "$REPO" 2>/dev/null || continue

    if git rev-parse --verify "$branch" >/dev/null 2>&1; then
      git checkout "$branch" >/dev/null 2>&1
      commits=$(git log --oneline --since="15 minutes ago" 2>/dev/null | grep -v "^$" | wc -l)
      log "  [1] New commits (15min window): $commits"

      complete_file="$REPO/CHUNK${branch#pr[0-9]}_COMPLETE.md"
      if [ -f "$complete_file" ]; then
        log "  [0] ✓ CHUNK${branch#pr[0-9]}_COMPLETE.md found — ready for PR creation"
      else
        log "  [0]  No CHUNK file yet — awaiting agent completion"
      fi
    else
      log "  [!] Branch $branch does not exist locally yet"
    fi
  done

  log "=== TICK END — sleeping ${INTERVAL}s ==="
  cat >> "$LOG" << 'EOF'

EOF
  sleep $INTERVAL
done
