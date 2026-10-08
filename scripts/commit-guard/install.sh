#!/usr/bin/env bash
# Installs the Jev commit guard into this repo's pre-commit hook (shared by every
# git worktree, since hooks live in the common git dir / core.hooksPath).
# Idempotent; keeps any existing hook content (e.g. code-review-graph).
set -euo pipefail
hooks_dir="$(git config --get core.hooksPath || true)"
[ -n "$hooks_dir" ] || hooks_dir="$(git rev-parse --git-common-dir)/hooks"
hook="$hooks_dir/pre-commit"
marker="# >>> vintel commit-guard >>>"
mkdir -p "$hooks_dir"
[ -f "$hook" ] || printf '#!/bin/sh\n' > "$hook"
if grep -qF "$marker" "$hook"; then
  echo "commit-guard already installed in $hook"
  exit 0
fi
cat >> "$hook" <<'HOOK'
# >>> vintel commit-guard >>>
# Jev-backed secret / private-material gate over staged changes
# (scripts/commit-guard/commit_guard.py). Skipped on branches that predate it.
guard="$(git rev-parse --show-toplevel)/scripts/commit-guard/commit_guard.py"
if [ -f "$guard" ]; then
  python3 "$guard" || exit 1
fi
# <<< vintel commit-guard <<<
HOOK
chmod +x "$hook"
echo "commit-guard installed in $hook"
