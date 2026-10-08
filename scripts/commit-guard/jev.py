"""Minimal client for TypeSafe Jev (OpenRouter Decisions API): typed yes/no, choice and score answers
with calibrated probabilities. Never raises into the caller: any failure (provider not allowed,
timeout, bad response) returns None, so every call site must keep a fallback path.

    from jev import decide
    a = decide({"before": b, "after": a}, {"adds_fact": {"type": "noul", "instructions": "...",
               "criteria": {"true": "...", "false": "..."}}})
    if a and a["adds_fact"]["noul"] > 0.8: ...

Ported from hex-expan (scripts/jev.py) on 2026-10-08. Same endpoint/model the
worker's JevTextParser uses. Key: OPENROUTER_API_KEY from the environment, else
web/.env.local (this repo's local env file). Requires "TypeSafe" in the
OpenRouter account's allowed providers.
"""
import json
import os
import pathlib
import subprocess
import urllib.request

URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = "~typesafe/jev-latest"


def _key():
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    # This checkout first, then the main checkout (git worktrees have no web/.env.local).
    candidates = [pathlib.Path(__file__).resolve().parents[2] / "web" / ".env.local"]
    try:
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], capture_output=True, text=True,
                                cwd=pathlib.Path(__file__).resolve().parent).stdout.strip()
        if common:
            candidates.append((pathlib.Path(__file__).resolve().parent / common).resolve().parent / "web" / ".env.local")
    except Exception:
        pass
    for env in candidates:
        if not env.exists():
            continue
        for line in env.read_text().splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    return None  # CI / fresh clone: no key -> callers fall back to UNCHECKED


def decide(state, questions, timeout=5.0):
    """state: str | dict | list; questions: {name: {type: noul|choice|score, instructions, criteria}}.
    Returns the `answers` dict, or None on any failure."""
    key = _key()
    if not key:
        return None
    body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Hex-Tech-Lab/hex-yt-intel", "X-Title": "vIntel commit guard"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout)).get("answers")
    except Exception:
        return None


if __name__ == "__main__":
    ans = decide("Help! My payouts have been failing for 3 days.", {"is_urgent": {
        "type": "noul", "instructions": "Does this message convey urgency?",
        "criteria": {"true": "Explicitly time-sensitive", "false": "No urgency expressed"}}})
    print("Jev unavailable (check the OpenRouter allowed providers: add TypeSafe)" if ans is None else ans)
