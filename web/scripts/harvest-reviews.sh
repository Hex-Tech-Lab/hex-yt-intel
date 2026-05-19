#!/bin/bash
set -euo pipefail

PR_IDS=(17 18 19 20 21)
OUTPUT_LOG="web/scripts/harvested_ai_prompts.md"
REPO="Hex-Tech-Lab/hex-yt-intel"

echo "# Consolidated AI Review & Prompt Harvest Log" > "$OUTPUT_LOG"
echo "Generated on: $(date -u +'%Y-%m-%d %H:%M:%S UTC')" >> "$OUTPUT_LOG"
echo "Repository: $REPO" >> "$OUTPUT_LOG"
echo "---" >> "$OUTPUT_LOG"
echo "" >> "$OUTPUT_LOG"

for PR in "${PR_IDS[@]}"; do
  echo "==> Scraping PR #$PR..."

  {
    echo "## PR #$PR Review Payload"
    echo ""
    echo "**Link:** https://github.com/$REPO/pull/$PR"
    echo ""

    # Get PR metadata
    PR_TITLE=$(gh pr view "$PR" --repo "$REPO" --json title -q '.title' 2>/dev/null || echo "N/A")
    PR_STATE=$(gh pr view "$PR" --repo "$REPO" --json state -q '.state' 2>/dev/null || echo "N/A")
    echo "**Title:** $PR_TITLE"
    echo "**State:** $PR_STATE"
    echo ""

    # Collect PR body comments
    echo "### Issue/Review Thread Comments"
    echo ""
    gh pr view "$PR" --repo "$REPO" --json comments --template '{{range .comments}}**@{{.author.login}}** ({{.createdAt}}):{{"\n"}}{{.body}}{{"\n\n"}}{{end}}' 2>/dev/null || echo "_No thread comments found._"
    echo ""

    # Collect inline code review comments
    echo "### Inline Code Review Comments"
    echo ""
    gh api "repos/$REPO/pulls/$PR/comments" --template '{{range .}}**{{.path}}:{{.line}}** (@{{.user.login}}):{{"\n"}}>{{.body}}{{"\n\n"}}{{end}}' 2>/dev/null || echo "_No inline comments found._"
    echo ""

    echo "---"
    echo ""
  } >> "$OUTPUT_LOG"
done

echo "✓ Telemetry harvesting complete. Output: $OUTPUT_LOG"
echo ""
echo "Summary:"
gh pr list --repo "$REPO" --state open --json number,title --jq '.[] | select(.number >= 17 and .number <= 21) | "  PR #\(.number): \(.title)"' 2>/dev/null || echo "  (review summary unavailable)"
