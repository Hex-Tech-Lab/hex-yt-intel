#!/usr/bin/env bash
# Installs the Jev commit guard into this repo's pre-commit hook (shared by every
# git worktree, since hooks live in the common git dir / core.hooksPath).
# Idempotent; keeps any existing hook content (e.g. code-review-graph). The guard
# block goes right after the shebang so an earlier `exit` in the hook cannot skip it.
set -euo pipefail
top="$(git rev-parse --show-toplevel)"
hooks_dir="$(git config --get core.hooksPath || true)"
if [ -z "$hooks_dir" ]; then
  hooks_dir="$(cd "$top" && git rev-parse --path-format=absolute --git-common-dir)/hooks"
elif [ "${hooks_dir#/}" = "$hooks_dir" ]; then
  hooks_dir="$top/$hooks_dir"  # git resolves a relative core.hooksPath from the working-tree root
fi
hook="$hooks_dir/pre-commit"
marker="# >>> vintel commit-guard >>>"
mkdir -p "$hooks_dir"
[ -f "$hook" ] || printf '#!/bin/sh\n' > "$hook"
if grep -qF "$marker" "$hook"; then
  echo "commit-guard already installed in $hook"
  exit 0
fi
case "$(head -n1 "$hook")" in
  '#!/bin/sh'*|'#!/bin/bash'*|'#!/usr/bin/env sh'*|'#!/usr/bin/env bash'*) ;;
  *) echo "commit-guard: $hook is not a sh/bash script; add the guard call to it by hand" >&2; exit 1 ;;
esac
block="$(cat <<'HOOK'
# >>> vintel commit-guard >>>
# Jev-backed secret / private-material gate over staged changes
# (scripts/commit-guard/commit_guard.py). Skipped on branches that predate it.
guard="$(git rev-parse --show-toplevel)/scripts/commit-guard/commit_guard.py"
if [ -f "$guard" ]; then
  python3 "$guard" || exit 1
fi
# <<< vintel commit-guard <<<
HOOK
)"
tmp="$(mktemp "$hooks_dir/.pre-commit.XXXXXX")"
{ head -n1 "$hook"; printf '%s\n' "$block"; tail -n +2 "$hook"; } > "$tmp"
chmod +x "$tmp"
mv "$tmp" "$hook"
echo "commit-guard installed in $hook"
