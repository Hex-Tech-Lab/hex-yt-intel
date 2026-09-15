# Part 2: ADR Status Delta + Prelaunch Checklist Cross-Match (2026-09-05)

## ADR 023 / 024 — implemented since CLAUDE.md's table was last edited

Both marked 🔍 in CLAUDE.md's table are DONE, contrary to the table:

- **ADR 023** (client-side KG fallback on restore): `15735cea` / `d7e5d052` "fix(knowledge-graph): ADR 023 reliable client-side fallback on restore" (#209), plus follow-up `190acfb6` (dead state removal), `af8ec871` (URL-encode fix, Wave-2 audit #209). CLAUDE.md's ADR table is stale — needs 023 flipped to ✅.
- **ADR 024** (happy-dom + RTL, 4 regression tests): `e6858155`/`3ce0e5de` "test(hooks,components): ADR 024 happy-dom + RTL setup" (#212), `9dd54d3a` (JSX transform blocker fix), `cab7a1d5` (post-review findings), `4a9e46e8` (vitest include glob widened), `d4ca6083`/`f0cc4831` (#219, stale TimestampLink assertions repaired). `web/package.json` confirms `happy-dom` and `@testing-library/react` are installed deps. Also stale in CLAUDE.md's table.

**New ADR not yet in CLAUDE.md's table at all: ADR 026** — "normalized kg_entity_mentions schema" Phase 2, `720e86bc` (#230), with a large follow-on entity-taxonomy/color-system remediation chain (`88d03e07`, `84ed269d` #239, `f2559f22`, `dbb84a44` #272, `d967c07a`, `6c4dcbec`). This is a substantial undocumented body of work — CLAUDE.md's ADR ledger needs a new row for ADR 026 and probably a rationale note that it superseded/extended the taxonomy work tracked in the pre-launch checklist's §1/§1e.

## Prelaunch checklist located

`docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` (last internal audit timestamp inside the doc: 2026-08-19). No separate "gap audit" doc was found under that name — the commit message "prelaunch gap audit done" (82fc8732, ledger-only chore) appears to refer to ledger cleanup, not a distinct doc; the harden commit itself (AudioContext singleton, short-form budget clamp, Sentry/budget regression tests) maps to checklist item **6b** (load/duration stress) and general hardening, not a checklist item that gets explicitly checked off in the file.

## Cross-match (checklist state as of 2026-08-19 vs. current repo state)

Estimated completion at the checklist's own last audit: **~30-35%** (6 done, 3 in-progress, 4 blocked, ~20 not-started, of ~35 line items). This part-2 fork did not re-verify every single line item against current code (that's git-log/PR evidence only, no live prod check) — treat the following as directional, cross-checked against commit messages only:

**Likely advanced since 08-19** (evidence: matching commit messages after that date):
- §1.2 PR #239 — merged (referenced as landed in ADR 026 chain above, `88d03e07` and successors exist on main).
- §6.3 bug triage issues #241 (cascade SSOT)/#242/#243 — no direct evidence found in this fork's scope; flag for part-1 (commit inventory) fork to confirm via `gh issue view 241/242/243`.
- Entity/taxonomy/KG stabilization (§1, §1e context) — heavily worked (7+ commits post-#239 through `dbb84a44` #272).

**Still MISSING, no evidence of progress found**:
- §2 (Paddle payment integration) — no Paddle-adapter commits found in the ADR/KG-focused search this fork ran; **this was explicitly flagged in the checklist itself as the single biggest launch risk on 08-19** and this fork found no contradicting evidence. Needs explicit confirmation from the commit-inventory fork (search `git log --oneline --all -- "**/paddle*" "**/billing*"`).
- §1e.1 (LLMCascade.ts hardcoded provider order, missing Azure, bypasses Settings Registry SSOT) — not investigated this pass; HIGH PRIORITY per checklist's own language, needs direct file check (`worker/src/services/LLMCascade.ts`).
- §6b.1/6b.2 (5hr video max-duration test, 50-concurrent-user load test) — no evidence searched.
- §7.2 (pairwise test matrix) — checklist itself says "not a revival candidate," no reason to expect this changed.
- §5 (GDPR footnote, T&C data-handling language) — not checked.

## Top 5 items for the master report's Action Plan

1. **CLAUDE.md ADR table is stale**: mark 023/024 ✅, add ADR 026 row — low effort, do now.
2. **§2 Paddle/payments** — confirm via commit search whether this moved at all since 08-19; if not, this is the #1 launch risk per the checklist's own audit and has apparently gone untouched through a large KG/taxonomy work cycle.
3. **§1e.1 cascade provider-order SSOT bug** — verify `worker/src/services/LLMCascade.ts` directly; checklist flags this as launch-blocking and unresolved as of 08-19.
4. **The checklist file itself needs a fresh audit pass** — its last "real status audit" is dated 2026-08-19, i.e. it is now ~17 days stale relative to this review's ~10-day-old boundary claim, and given the scale of KG/taxonomy work found in git log, a large fraction of its content is likely outdated in both directions (some items done that it marks ⬜, its own priority ranking possibly wrong now).
5. **No visible checklist item tracks the KG/taxonomy remediation chain** (ADR 026, #230/#239/#272) — this was apparently a multi-day, multi-PR effort not represented anywhere in the launch-readiness document at all, meaning the checklist's completion percentage is being computed against an incomplete inventory of real work.
