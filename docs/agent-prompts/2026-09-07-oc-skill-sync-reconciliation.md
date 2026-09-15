# Agent Dispatch Prompt — Skill-sync reconciliation, ~/.claude/skills vs ~/.gemini/skills

**Target Agent**: OC (OpenCode, glm-5.3-flash)
**Effort Level**: low

This task does NOT touch the hex-yt-intel git repository at all — it operates
entirely on `~/.claude/skills` and `~/.gemini/skills`, both outside any git
worktree. The AGENTS.md ledger protocol below still applies for coordination
visibility, but there is no code-review-skill-decision-tree section for this
dispatch (no repo diff to gate).

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> Read `.memory/AGENT_LEDGER.md` (in `/home/kellyb_dev/projects/hex-yt-intel`)
> AND `.memory/ADRS.md` before starting, even though this task touches no
> repo files — other sessions may be mid-way through skill work. Post
> `[IN_PROGRESS]` with intent as your first action; post `[DONE]`/`[BLOCKED]`
> with a real summary of what actually happened as your last action.

---

## 1. Context & Problem Statement

Most of `~/.claude/skills` is already mirrored into `~/.gemini/skills` via
symlinks (e.g. `~/.gemini/skills/design -> ~/.claude/skills/design`), and one
naming alias already exists (`~/.gemini/skills/database-architect-10x ->
~/.claude/skills/db-arch-10x`). This was verified fresh (2026-09-07) via:

```bash
comm -23 <(ls ~/.claude/skills | sort) <(for f in ~/.gemini/skills/*; do if [ -L "$f" ]; then basename "$(readlink -f "$f")"; else basename "$f"; fi; done | sort -u)
```

which returns exactly 5 names present in `~/.claude/skills` with NO symlink
counterpart anywhere in `~/.gemini/skills`:

```
database-sentinel
llm-council
race-condition-guard
stress-test
taste-skill
```

Additionally, `~/.gemini/skills/antigravity-support` is a REAL directory
(not a symlink) with no counterpart in `~/.claude/skills` at all — it may be
Gemini/Antigravity-specific tooling that should never be mirrored, or it may
be an omission on the Claude side. Do not assume either way — investigate.

## 2. Contract & Implementation Directives

**Contract**: after this task, `~/.gemini/skills` must contain a working
symlink for every one of the 5 missing skill names, pointing at the correct
`~/.claude/skills/<name>` directory, matching the exact pattern already used
for the other ~54 already-synced skills. `antigravity-support`'s situation
must be explicitly reported (not silently left alone or silently copied)
with a recommendation.

**Implementation approach**:
1. For each of the 5 missing names, inspect the actual directory contents at
   `~/.claude/skills/<name>` (read its `SKILL.md` frontmatter) to confirm it
   is a real, complete skill (not a stub or WIP) before symlinking it.
2. Create the symlink using the exact same relative/absolute path style
   already used by the existing synced skills (check with `readlink` on an
   existing example, e.g. `readlink ~/.gemini/skills/design`, and match that
   style precisely — do not introduce a different symlink style for the new
   ones).
3. Verify each new symlink resolves correctly (`ls -la ~/.gemini/skills/ |
   grep <name>` and confirm the target directory is reachable and non-empty).
4. For `antigravity-support`: read its contents, determine what it actually
   does, and check whether anything in `~/.claude/skills` or this repo's own
   skill listing references equivalent functionality. Report your finding
   and a one-line recommendation (mirror it into `~/.claude/skills` as a real
   directory, leave it Gemini-only on purpose, or something else) — do NOT
   act on the recommendation yourself, just report it.
5. Do not touch, rename, or restructure any existing skill directory or
   existing symlink. This is additive-only.

## 3. Pre-PR Review Skills Decision Tree

Not applicable — no repo files touched, no PR needed.

## 4a. Verification & Quality Gates (local)

```bash
# Confirm the gap is fully closed:
comm -23 <(ls ~/.claude/skills | sort) <(for f in ~/.gemini/skills/*; do if [ -L "$f" ]; then basename "$(readlink -f "$f")"; else basename "$f"; fi; done | sort -u)
# Expected output: empty (or only antigravity-support-adjacent names you've explicitly decided to leave unsynced)
```

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual command output) → Tangents found → Deviations flagged → Gates → Files/symlinks changed.

Report back the full list of symlinks created (with their `readlink` output)
and your `antigravity-support` finding + recommendation. No commit/push
needed since this is outside any git repo.
