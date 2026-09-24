#!/usr/bin/env bash
# ADR 032 wave 2a spike S2 — R2: YouTube fetch success from Vercel (cdg1).
# Usage: run-youtube-fetch.sh <preview-url>
# Requires VERCEL_TOKEN + LOGS_SNAPSHOT_HMAC_SECRET in env (loaded from web/.env.local).
set -euo pipefail
: "${1:?Usage: run-youtube-fetch.sh <preview-url>}"
PREVIEW_URL="$1"

set -a
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=/dev/null
. "$REPO_ROOT/web/.env.local"
set +a

OUT="$REPO_ROOT/.scratch/vercel-protection-bypass.json"
PROJ=prj_jKAo3z8jKyHwi3qXqSIeoZO1ILku
TEAM=team_vgnBI2s3ynPBzQdOLqhGvBnK

# Get or create a protection bypass for the preview deployment's SSO.
BYPASS=$(curl -s -X GET "https://api.vercel.com/v1/projects/$PROJ/protection-bypass?teamId=$TEAM" \
  -H "Authorization: Bearer $VERCEL_TOKEN")
if ! echo "$BYPASS" | grep -q "bypassTokenKey\|href\|creationDate"; then
  BYPASS=$(curl -s -X POST "https://api.vercel.com/v1/projects/$PROJ/protection-bypass?teamId=$TEAM" \
    -H "Authorization: Bearer $VERCEL_TOKEN")
fi
echo "$BYPASS" > "$OUT"
BYPASS_KEY=$(node -e "const b=require('$OUT'); const v=Object.values(b)[0]; console.log(typeof v==='object'?Object.keys(v)[0]||v:v)" 2>/dev/null || true)

IDS="f6We53TnkbU,4mTLpuQpB80,ymgH8jS6Wb8,tTnUcSj-QPA,436vK7SrhF8,MoBr0nQtOnA,NE-62S4OYCg,XMA9iZEUL0s,_WXIpV5YJAU,CkBCmlvs4X4,dQw4w9WgXcQ,Unzc731iCUY,pjGvA-D0Fcs,q9Jo5P_qles,rQvpckcWWK0,1U8-4N1HNtU,BKtrCo2OZKw,S4F7EB0sQzY,tkL76_jQnCY,ryf-0Z0Ba0E"

curl -s --max-time 330 "$PREVIEW_URL/api/spikes/youtube-fetch?ids=$IDS" \
  -H "x-spike-secret: $LOGS_SNAPSHOT_HMAC_SECRET" \
  -H "x-vercel-protection-bypass: $BYPASS_KEY" \
  -o "$REPO_ROOT/.scratch/spike-s2-results.json"
node -e "
const r=require('$REPO_ROOT/.scratch/spike-s2-results.json');
console.log('verdict:', r.verdict, '| transcript ok:', r.transcriptOk+'/'+r.total);
for (const v of r.results ?? []) {
  console.log(v.videoId, '| t:', v.transcript.ok, v.transcript.latencyMs+'ms', v.transcript.bytes+'B', v.transcript.status??'', v.transcript.error??'');
}
"