#!/usr/bin/env bash
# ADR 032 wave 2a spike S4 — chunk LLM stream held end-to-end on Vercel Fluid (300 s).
# Usage: run-chunk-stream.sh <preview-url> <mode: full|disconnect> [model] [runs] [out-file]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
: "${1:?Usage: run-chunk-stream.sh <preview-url> <full|disconnect> [model] [runs] [out-file]}"
PREVIEW_URL="$1"
MODE="${2:-full}"
MODEL="${3:-anthropic/claude-haiku-4.5}"
RUNS="${4:-3}"
OUT="${5:-$REPO_ROOT/.scratch/spike-s4-results.json}"

set -a
# shellcheck source=/dev/null
. "$REPO_ROOT/web/.env.local"
set +a

PROJ=prj_jKAo3z8jKyHwi3qXqSIeoZO1ILku
TEAM=team_vgnBI2s3ynPBzQdOLqhGvBnK

# Get or create a protection bypass for the preview deployment's SSO.
BYPASS=$(curl -s -X GET "https://api.vercel.com/v1/projects/$PROJ/protection-bypass?teamId=$TEAM" \
  -H "Authorization: Bearer $VERCEL_TOKEN")
if ! echo "$BYPASS" | grep -q "bypassTokenKey\|href\|creationDate"; then
  BYPASS=$(curl -s -X POST "https://api.vercel.com/v1/projects/$PROJ/protection-bypass?teamId=$TEAM" \
    -H "Authorization: Bearer $VERCEL_TOKEN")
fi
echo "$BYPASS" > "$REPO_ROOT/.scratch/vercel-protection-bypass.json"
BYPASS_KEY=$(node -e "const b=require('$REPO_ROOT/.scratch/vercel-protection-bypass.json'); const v=Object.values(b)[0]; console.log(typeof v==='object'?Object.keys(v)[0]||v:v)" 2>/dev/null || true)

: > "$OUT"
for i in $(seq 1 "$RUNS"); do
  RUN_ID="s4-${MODE}-$(date +%s)-$i"
  MAX_TIME=600
  if [ "$MODE" = "disconnect" ]; then MAX_TIME=20; fi
  T0=$(date +%s.%N)
  HTTP_CODE=$(curl -s --max-time "$MAX_TIME" -o "$REPO_ROOT/.scratch/s4-run-body.txt" \
    -w '%{http_code} %{size_download} %{time_starttransfer} %{time_total}' \
    "$PREVIEW_URL/api/spikes/chunk-stream?runId=$RUN_ID&model=$MODEL" \
    -H "x-spike-secret: $LOGS_SNAPSHOT_HMAC_SECRET" \
    -H "x-vercel-protection-bypass: $BYPASS_KEY" \
    > "$REPO_ROOT/.scratch/s4-run-meta.txt"; echo $?)
  T1=$(date +%s.%N)
  if [ "$HTTP_CODE" != "0" ]; then
    echo "{\"runId\":\"$RUN_ID\",\"curlFailed\":true,\"exitCode\":$HTTP_CODE}" >> "$OUT"
    continue
  fi
  BYTES=$(cut -d' ' -f2 "$REPO_ROOT/.scratch/s4-run-meta.txt" 2>/dev/null || echo 0)
  TTFB=$(cut -d' ' -f3 "$REPO_ROOT/.scratch/s4-run-meta.txt" 2>/dev/null || echo 0)
  TOTAL=$(cut -d' ' -f4 "$REPO_ROOT/.scratch/s4-run-meta.txt" 2>/dev/null || echo 0)
  BYTES=${BYTES:-0}; TTFB=${TTFB:-0}; TOTAL=${TOTAL:-0}
  echo "{\"runId\":\"$RUN_ID\",\"model\":\"$MODEL\",\"mode\":\"$MODE\",\"bytes\":$BYTES,\"ttfb\":$TTFB,\"total\":$TOTAL,\"runSec\":$(echo "$T1-$T0" | bc)}" >> "$OUT"
  echo "$RUN_ID $BYTES $TTFB $TOTAL"
done
echo "Results written to $OUT"
