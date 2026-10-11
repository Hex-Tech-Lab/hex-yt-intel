#!/usr/bin/env bash
# strict-merge.sh - refuse to merge a PR while it has unresolved review threads,
# failing or pending checks, or a merge state that GitHub itself would block.
#
# Usage: scripts/strict-merge.sh <pr-number> [--bypass "Check A,Check B"] [--merge]
#   --bypass  comma-separated check names to ignore. Must be named explicitly and
#             every bypassed name is printed, so a bypass is never silent.
#   --merge   on pass, squash-merge with --match-head-commit set to the head SHA
#             the gate just checked, so a push that lands after the gate is refused.
#             Without --merge the script only gates and exits 0 on pass.
# Exit: 0 gate passed, 1 gate refused or error.
set -euo pipefail

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

PR=""
BYPASS=""
MERGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bypass) BYPASS="${2:-}"; shift 2 ;;
    --merge) MERGE=1; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown flag: $1" >&2; usage ;;
    *)
      [[ -z "$PR" ]] || usage
      PR="$1"
      shift
      ;;
  esac
done

[[ "$PR" =~ ^[0-9]+$ ]] || usage
command -v gh >/dev/null || { echo "strict-merge: gh CLI required" >&2; exit 1; }
command -v jq >/dev/null || { echo "strict-merge: jq required" >&2; exit 1; }

REPO=$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')
OWNER=${REPO%%/*}
NAME=${REPO##*/}

PR_JSON=$(gh pr view "$PR" --json state,isDraft,mergeable,mergeStateStatus,headRefOid,title,statusCheckRollup)
HEAD_SHA=$(jq -r '.headRefOid' <<<"$PR_JSON")
TITLE=$(jq -r '.title' <<<"$PR_JSON")

THREADS_JSON=$(gh api graphql \
  -F owner="$OWNER" -F name="$NAME" -F number="$PR" \
  -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            pageInfo { hasNextPage }
            nodes { isResolved path line }
          }
        }
      }
    }')

VIOLATIONS=()

STATE=$(jq -r '.state' <<<"$PR_JSON")
DRAFT=$(jq -r '.isDraft' <<<"$PR_JSON")
MERGEABLE=$(jq -r '.mergeable' <<<"$PR_JSON")
MSTATE=$(jq -r '.mergeStateStatus' <<<"$PR_JSON")

[[ "$STATE" == "OPEN" ]] || VIOLATIONS+=("PR state is $STATE, not OPEN")
[[ "$DRAFT" == "false" ]] || VIOLATIONS+=("PR is a draft")
[[ "$MERGEABLE" == "MERGEABLE" ]] || VIOLATIONS+=("mergeable is $MERGEABLE (conflicts or unknown)")
case "$MSTATE" in
  CLEAN|HAS_HOOKS|UNSTABLE) ;;
  *) VIOLATIONS+=("mergeStateStatus is $MSTATE (GitHub would block this merge)") ;;
esac

HAS_NEXT=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$THREADS_JSON")
if [[ "$HAS_NEXT" == "true" ]]; then
  VIOLATIONS+=("more than 100 review threads; cannot verify all are resolved")
fi
OPEN_THREADS=$(jq -r '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' <<<"$THREADS_JSON")
if [[ "$OPEN_THREADS" -gt 0 ]]; then
  VIOLATIONS+=("$OPEN_THREADS unresolved review thread(s)")
  while IFS= read -r line; do
    VIOLATIONS+=("  thread: $line")
  done < <(jq -r '.data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved == false) | "\(.path):\(.line // "?")"' <<<"$THREADS_JSON")
fi

# Check rows come in two shapes: CheckRun (name, status, conclusion) and
# StatusContext (context, state). Passing = SUCCESS, SKIPPED or NEUTRAL.
BYPASSED_SEEN=()
# Captured in a variable (not a process substitution) so a jq failure aborts
# the script under set -e instead of silently producing zero violations.
CHECKS_TSV=$(jq -r '
  .statusCheckRollup[]
  | . as $r
  | [($r.name // $r.context // "?"),
     (($r.conclusion // "") | if . == "" then ($r.state // $r.status // "PENDING") else . end)]
  | select(.[1] | IN("SUCCESS", "SKIPPED", "NEUTRAL") | not)
  | @tsv' <<<"$PR_JSON" | sort -u)
while IFS=$'\t' read -r name result; do
  [[ -n "$name" ]] || continue
  if [[ ",$BYPASS," == *",$name,"* ]]; then
    BYPASSED_SEEN+=("$name ($result)")
    continue
  fi
  VIOLATIONS+=("check not passing: $name = $result")
done <<<"$CHECKS_TSV"

echo "strict-merge: PR #$PR - $TITLE"
echo "  head: $HEAD_SHA"
if [[ ${#BYPASSED_SEEN[@]} -gt 0 ]]; then
  echo "  BYPASSED (explicit --bypass): $(IFS=';'; echo "${BYPASSED_SEEN[*]}")"
fi

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "  REFUSED - ${#VIOLATIONS[@]} gate violation(s):"
  for v in "${VIOLATIONS[@]}"; do
    echo "    - $v"
  done
  exit 1
fi

echo "  GATE PASSED: 0 unresolved threads, all checks passing or bypassed, mergeable."

if [[ "$MERGE" -eq 1 ]]; then
  gh pr merge "$PR" --squash --match-head-commit "$HEAD_SHA"
  echo "  MERGED #$PR (squash) at $HEAD_SHA"
fi
