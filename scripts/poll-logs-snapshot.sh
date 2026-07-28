#!/usr/bin/env bash
# Polls /api/admin/logs/snapshot with a signed HMAC header pair instead of a
# browser admin session -- lets the orchestrator (or CI) pull a full,
# one-call view of every log provider without going through 7-8 separate
# requests. Secret lives in web/.env.local (LOGS_SNAPSHOT_HMAC_SECRET) and as
# a Vercel prod env var, never printed or embedded in a command line.
#
# Usage: scripts/poll-logs-snapshot.sh [range] [base_url]
#   range:    30m | 1h | today | custom (default: 1h)
#   base_url: default https://yt-intel.getmytestdrive.com

set -euo pipefail

RANGE="${1:-1h}"
BASE_URL="${2:-https://yt-intel.getmytestdrive.com}"
ENV_FILE="$(dirname "$0")/../web/.env.local"

SECRET=$(grep '^LOGS_SNAPSHOT_HMAC_SECRET=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "LOGS_SNAPSHOT_HMAC_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

EXP=$(( $(date +%s%3N) + 55000 ))
MESSAGE="logs-snapshot:${EXP}"
SIG=$(printf '%s' "$MESSAGE" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -s \
  -H "X-Snapshot-Sig: ${SIG}" \
  -H "X-Snapshot-Exp: ${EXP}" \
  "${BASE_URL}/api/admin/logs/snapshot?range=${RANGE}"
