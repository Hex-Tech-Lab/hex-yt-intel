#!/usr/bin/env python3
"""Commit guard for hex-yt-intel: pre-commit gate over STAGED changes only.

Ported from hex-expan (scripts/commit_guard.py, T37-W1c) on 2026-10-08 and adapted
to this repo's secrets and sensitive material.

Reads `git diff --cached` (read-only git) or a synthetic diff via --diff-file (tests).
Deterministic layer (exit 1 immediately on any hit):
  - key-like strings: OpenRouter sk-or-v1-..., generic sk-..., Bearer <token>, AKIA...,
    JWTs (Supabase service-role keys are JWTs), long secrets near key/token/secret
  - .env content: added dotenv-style assignments for secret-ish variable names
  - forbidden paths: local env/secret files and tool state that must never be committed
Jev layer on added TEXT hunks (first 60 lines each; deterministic checks read every line), two yes/no questions per hunk:
  private_material - private/internal ADR content, unreleased pricing or COGS, customer
                     or user personal data, legal/contract strategy
  secret_like      - looks like a credential, key, token or secret
Bands: p >= 0.8 -> BLOCK (exit 1), 0.5-0.8 -> FLAG (printed, exit 0), < 0.5 -> PASS.
Jev down / no key / --no-jev -> UNCHECKED (never blocks); after the first unavailable answer the
remaining hunks skip Jev, so an outage costs one timeout, not one per hunk.

A line containing `commit-guard: allow` is skipped by the deterministic key-like check
(for deliberate test fixtures); it is still sent to Jev.

Usage: python3 scripts/commit-guard/commit_guard.py [--diff-file <path>] [--no-jev]
"""
import argparse
import ast
import math
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jev import decide  # noqa: E402

LO, HI = 0.5, 0.8
JEV_TIMEOUT_S = 10
ALLOW_MARKER = "commit-guard: allow"

# Paths that must never be staged in this repo (deletions are allowed: untracking is the fix).
FORBIDDEN_PREFIXES = ("supabase/.temp/", ".ori/", ".scratch/", "web/.next/")
FORBIDDEN_BASENAMES = (".dev.vars",)
FORBIDDEN_SUFFIXES = (".pem", ".p12", ".key")
ENV_FILE = re.compile(r"(^|/)\.env(\..+)?$")
ENV_FILE_ALLOWED_SUFFIXES = (".example", ".template", ".sample")  # e.g. web/.env.local.example

QUESTIONS = {
    "private_material": {"type": "noul",
        "instructions": "Does this diff hunk expose private or internal material that should not be committed to a "
                        "shared code repository: private/internal architecture-decision content, unreleased pricing or "
                        "cost (COGS) figures, customer or user personal data, or legal/contract strategy? Ordinary "
                        "source code, tests, configuration without secrets, and public documentation are NOT private.",
        "criteria": {"true": "It contains such private material.", "false": "It does not."}},
    "secret_like": {"type": "noul",
        "instructions": "Does this diff hunk contain a real credential, API key, access token, password, signing "
                        "secret or private key (not a placeholder, test fixture or variable name)?",
        "criteria": {"true": "It contains something secret-like.", "false": "It does not."}},
}

DETERMINISTIC = [
    re.compile(r"\bsk-or-v1-[A-Za-z0-9]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    re.compile(r"(?i)\b(?:key|token|secret)\b[^\n]{0,40}[A-Za-z0-9+/]{32,}\b"),
    re.compile(r"(?i)^[A-Za-z0-9_+/]{32,}$"),
]
# .env-style secret assignments (e.g. OPENROUTER_API_KEY=sk-...). An assignment with an empty value
# or a ${VAR} / <placeholder> reference is a template, not a leak.
ENV_ASSIGN = re.compile(r"(?im)^[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*[ \t]*=[ \t]*(?!$|\$\{|<|\"\"|'')\S")
JEV_HUNK_LINES = 60  # Jev sees at most this many lines per hunk; deterministic checks see every line


def is_env_template(path):
    return bool(ENV_FILE.search(path)) and path.endswith(ENV_FILE_ALLOWED_SUFFIXES)


def is_forbidden(path):
    base = path.rsplit("/", 1)[-1]
    if ENV_FILE.search(path) and not is_env_template(path):
        return True
    return (path.startswith(FORBIDDEN_PREFIXES) or base in FORBIDDEN_BASENAMES
            or path.endswith(FORBIDDEN_SUFFIXES))


def header_path(rest):
    """Path from a `+++ ` header remainder: b/<path>, a quoted "b/<path>" (git quotes unusual names), or /dev/null."""
    if rest.startswith('"'):
        try:
            rest = ast.literal_eval(rest).encode("latin-1").decode("utf-8")  # git C-quotes UTF-8 bytes as octal
        except (ValueError, SyntaxError, UnicodeError):
            rest = rest.strip('"')
    return rest[2:] if rest.startswith("b/") else rest


def hunks(diff_text):
    """[(file, [added lines])] per contiguous added run (every line; callers cap what Jev sees).
    Headers are only recognised before a file's first @@, so an added line whose content starts
    with `++` is never mistaken for a `+++` header."""
    out, cur_file, cur_adds, in_header = [], None, [], False
    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            if cur_file and cur_adds:
                out.append((cur_file, cur_adds))
            cur_adds, in_header = [], True
        elif in_header and line.startswith("+++ "):
            cur_file = header_path(line[4:])
        elif line.startswith("@@"):
            if cur_file and cur_adds:
                out.append((cur_file, cur_adds))
            cur_adds, in_header = [], False
        elif in_header:
            continue
        elif line.startswith("+"):
            cur_adds.append(line[1:])
        elif cur_adds:
            out.append((cur_file, cur_adds))
            cur_adds = []
    if cur_file and cur_adds:
        out.append((cur_file, cur_adds))
    return out


def jev_score(answers):
    """max(private_material, secret_like) as a probability, or None if the answer is malformed."""
    try:
        p = max(float(answers["private_material"]["noul"]), float(answers["secret_like"]["noul"]))
    except (KeyError, TypeError, ValueError):
        return None
    return p if math.isfinite(p) and 0.0 <= p <= 1.0 else None


def staged_paths(diff, diff_file):
    """Every staged path: from the diff headers, binary notices, and (live mode) git's own name list."""
    paths = {f for f, _ in hunks(diff)}
    paths |= set(re.findall(r"^Binary files .* and b/(.+) differ$", diff, re.M))
    if not diff_file:
        paths |= set(subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=d", "-z"],
                                    capture_output=True, text=True).stdout.split("\0")) - {""}
    return paths


def check_hunk(fname, adds, no_jev, jev_down):
    """Check one added-line hunk. Returns (blocked, flag, jev_down); flag is (file, p, verdict) or None."""
    if is_forbidden(fname) or fname == "/dev/null":
        return False, None, jev_down
    checked = "\n".join(a for a in adds if ALLOW_MARKER not in a)
    if not is_env_template(fname) and ENV_ASSIGN.search(checked):
        print(f"BLOCK: secret assignment content in {fname}")
        return True, None, jev_down
    hit = next((n for n, a in enumerate(adds, 1) if ALLOW_MARKER not in a and any(rx.search(a) for rx in DETERMINISTIC)), None)
    if hit is not None:
        # Never echo any part of the match: name the file and the added-line position only.
        print(f"BLOCK: key-like string in {fname} (added line {hit} of this hunk; content withheld)")
        return True, None, jev_down
    return jev_check(fname, adds, no_jev, jev_down)


def jev_check(fname, adds, no_jev, jev_down):
    """Jev layer for one hunk. Same return shape as check_hunk."""
    if no_jev or jev_down:
        return False, (fname, None, "UNCHECKED (Jev off)" if no_jev else "UNCHECKED (Jev unavailable)"), jev_down
    answers = decide({"file": fname, "hunk": "\n".join(adds[:JEV_HUNK_LINES])}, QUESTIONS, timeout=JEV_TIMEOUT_S)
    if answers is None:
        return False, (fname, None, "UNCHECKED (Jev unavailable)"), True  # circuit breaker trips
    p = jev_score(answers)
    if p is None:
        return False, (fname, None, "UNCHECKED (unexpected Jev answer)"), jev_down
    if p >= HI:
        print(f"BLOCK: Jev p={p:.2f} on {fname}")
        return True, None, jev_down
    return False, (fname, p, "FLAG" if p >= LO else "PASS"), jev_down


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diff-file")
    ap.add_argument("--no-jev", action="store_true")
    args = ap.parse_args()
    if args.diff_file:
        diff = Path(args.diff_file).read_text()
    else:
        diff = subprocess.run(["git", "diff", "--cached"], capture_output=True, text=True).stdout

    worst, flags = 0, []
    for path in sorted(staged_paths(diff, args.diff_file)):
        if is_forbidden(path):
            print(f"BLOCK: forbidden path staged: {path}")
            worst = 1
    jev_down = False  # circuit breaker: one unavailable answer skips Jev for the rest of the commit
    for fname, adds in hunks(diff):
        blocked, flag, jev_down = check_hunk(fname, adds, args.no_jev, jev_down)
        worst = 1 if blocked else worst
        if flag:
            flags.append(flag)
    for fname, p, verdict in flags:
        print(f"{verdict}{'' if p is None else f' (p={p:.2f})'}: {fname}")
    print(f"COMMIT-GUARD: {'BLOCK' if worst else 'CLEAR'} ({len(flags)} Jev-checked hunks)")
    if worst:
        print("Fix the staged content, or if this is a false positive, add `commit-guard: allow` to the line "
              "(deterministic checks) or commit with --no-verify after review.")
    sys.exit(worst)


if __name__ == "__main__":
    main()
