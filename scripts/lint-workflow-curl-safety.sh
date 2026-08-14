#!/usr/bin/env bash
# Fails if any .github/workflows/*.yml runs a `curl` call to an external API
# without either --fail/--fail-with-body (so a 4xx/5xx actually fails the
# step) or an explicit %{http_code} capture (so the caller checks it itself).
#
# RCA (2026-08-14): a deploy workflow's Vercel API calls were missing
# --fail-with-body for over a month. Plain curl exits 0 on a 4xx response
# body, so the workflow reported green while never actually applying the
# change it claimed to -- a live production incident went undetected because
# nobody, human or CI, ever looked at the actual response. This script is
# the enforcement so that gap can't recur silently in any workflow.
#
# Exemption: a curl call whose 3 preceding lines contain a comment with
# "curl-safety: intentional-diagnostic-only" is skipped -- for steps that
# must run under `if: always()` to show diagnostics even after a real check
# already failed, where --fail would wrongly turn a display step into a hard
# failure.
set -euo pipefail

FAILED=0

for file in .github/workflows/*.yml; do
  [ -f "$file" ] || continue
  total_lines=$(wc -l < "$file")

  # Real curl invocations only: line contains "curl " and is not a comment.
  while IFS= read -r lineno; do
    line_content=$(sed -n "${lineno}p" "$file")
    [[ "$line_content" =~ ^[[:space:]]*# ]] && continue

    lookback_start=$(( lineno - 3 > 0 ? lineno - 3 : 1 ))
    lookback=$(sed -n "${lookback_start},$(( lineno - 1 ))p" "$file")
    if grep -qF -- 'curl-safety: intentional-diagnostic-only' <<<"$lookback"; then
      continue
    fi

    # Extend through this curl's own backslash continuations only.
    end=$lineno
    while [ "$end" -le "$total_lines" ] && sed -n "${end}p" "$file" | grep -qE '\\\\$'; do
      end=$(( end + 1 ))
    done
    block=$(sed -n "${lineno},${end}p" "$file")

    if ! grep -qE -- '--fail(-with-body)?\b|[[:space:]]-f[[:space:]]' <<<"$block" \
       && ! grep -qE -- '%\{http_code\}' <<<"$block"; then
      echo "::error file=$file,line=$lineno::curl call has neither --fail/--fail-with-body nor a %{http_code} capture -- a 4xx/5xx response will silently report success:"
      echo "$block" | sed 's/^/    /'
      FAILED=1
    fi
  done < <(grep -nE 'curl[[:space:]]+(-|['"'"'"]?https?:)' "$file" | cut -d: -f1)
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "One or more workflow curl calls can silently succeed on a real API error."
  echo "Add --fail-with-body (preferred, keeps the error body in logs) or capture"
  echo "and check %{http_code} explicitly."
  exit 1
fi

echo "OK: all workflow curl calls guard against silent API failures."
