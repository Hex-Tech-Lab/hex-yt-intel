# THOS — 2026-09-07 03:13 — Audit, Security Fixes, and Skill SSOT Unification

**Session span**: 2026-09-05 through 2026-09-07. **Resume here.**

---

## 1. Why this session happened

User asked for a full forensic review of ~10 days of unsupervised work by
other agents (AGY/OC) since CC's last verified involvement (2026-08-20
vIntel rebrand merge, `ba94b9bf`). That review escalated into: finding and
fixing two live security criticals, a 10x re-audit using ~18 skills in
parallel, responding to two rounds of real automated PR review, building a
cross-agent skill single-source-of-truth (SSOT), pulling a design skill
(`impeccable`) up to its true upstream version, and baking two new standing
rules into the agent-dispatch template. None of it was pre-planned — each
step surfaced the next.

## 2. State of the world RIGHT NOW (read this first)

- **Branch**: `fix/security-idor-and-entitlements-bypass`, pushed, PR #286,
  **OPEN, MERGEABLE, NOT MERGED, NOT DEPLOYED**.
- **PR #287** (qa-intel rule engine, split out of #286 after review flagged
  scope-bundling): **OPEN, MERGEABLE, NOT MERGED**.
- **Both PRs are ready to merge.** This is the single highest-priority
  unfinished item — everything below the fold in this doc is real work, but
  the two live security bugs are still live in production until #286 merges
  AND the app redeploys AND the migration applies.
- Vercel env vars (`FOUNDER_USER_IDS`, `ADMIN_FOUNDER_EMAILS`) are already
  set in production — but the running deployment predates the code fix, so
  the old hardcoded bypass is still what's actually serving traffic.
- The IDOR migration (`20260905120000_fix_temporal_subgraph_idor.sql`) has
  only been validated against a Supabase branch preview, never applied to
  the real production database.

**Immediate next action on resume**: merge #286, merge #287, redeploy
Vercel, apply the migration to production, then run the post-deploy smoke
tests named in PR #286's own test plan (founder account still gets founder
tier; a `kelly.smith@...` email does NOT; `get_temporal_subgraph` rejects
cross-tenant calls).

## 3. Two critical security bugs found and fixed (PR #286)

1. **Entitlements bypass** (`web/lib/usecases/GetUserEntitlementsUseCase.ts`):
   a hardcoded `/kelly/i` regex + hardcoded owner-ID array granted
   founder-tier access to any email merely *containing* "kelly" — not an
   exact match. Duplicated an already-correct env-var mechanism 3 lines
   below. Fixed by deleting the hardcoded path entirely.
2. **Cross-tenant IDOR** (`get_temporal_subgraph`, ADR 028, migration
   `20260825150000_adr028_temporal_sqlgraph_simhash.sql`): used
   `auth.uid() IS NULL` as a proxy for "this is the service role," but
   `EXECUTE` was granted to `authenticated` too — any authenticated session
   whose JWT resolves `auth.uid()` to NULL (malformed JWT, anon-upgrade edge
   case) could read another user's analysis transcript content. Fixed via
   new migration `20260905120000_fix_temporal_subgraph_idor.sql`, checking
   `auth.jwt() ->> 'role' = 'service_role'` instead.

Both found via a 5-lane parallel 10x re-audit (18 skills:
code-reviewer/qa-intel/review-delta/review-duplication/react-best-practices/
web-design-guidelines/composition-patterns/db-arch-10x/database-sentinel/
supabase-postgres-best-practices/build-graph/pr-review-workflow/review-pr/
explore-codebase/owasp-top-10/race-condition-guard/stress-test/llm-council),
documented in full at `docs/AUDIT_2026-09-05_10x_MASTER.md` plus 5 lane
detail files (`docs/AUDIT_2026-09-05_10x_lane{A..E}_*.md`) and the original
boundary-setting audit at `docs/AUDIT_REPORT_2026-09-05.md` + 4 part files.

**Also found, not yet fixed (lower severity, tracked not forgotten)**:
- Real TOCTOU race in `PaddleBillingAdapter.ts` (webhook redelivery can
  revert billing state) — High severity, not part of #286's scope.
- `user_subscriptions` RLS has no INSERT/UPDATE/DELETE policy — safe today
  (service-role-only writes verified) but undocumented as intentional.
- PR Confidence Calculator (`scripts/calculate-pr-confidence.ts`) is
  structurally capped ~59% — scores against CodeRabbit/Snyk weights but
  this repo's real CI stack is Codacy/CodeFactor/DeepSource/Sourcery.
- `docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` is 17+ days stale, needs a
  fresh pass — its own completion % doesn't account for the large
  KG/taxonomy remediation chain (ADR 026) that shipped in the audited window.
- `LLMCascade.ts`'s hardcoded provider-order SSOT bypass (checklist §1e.1,
  flagged launch-blocking on 08-19) never independently re-verified.
- ~25+ stale `.claude/worktrees/agent-*` directories on disk, untouched.

## 4. Two rounds of real external review response (PR #286, #287)

An automated Cubic-style review caught, on #286: a real DeepSource
non-null-assertion finding (fixed), a missing `REVOKE EXECUTE FROM anon`
on the new migration (fixed), wrong `qa-intel` CLI syntax I'd introduced in
TEMPLATE.md (`--diff`/`--full` instead of the real `--mode diff`/`--mode
full` — fixed), and a stray section-numbering bug (4b with no 4a — fixed).

On #287 (the new qa-intel rules themselves): a **build-breaking bug**
(`stemKebab` referenced but never declared — my own refactor left a dangling
reference on the exact code path that mattered) and a **real
production-severity bug my own new tests caught, not the reviewer**: the
new `SecurityFixWithoutTestRule` derived its file path from
`source.getFilePath()` (ts-morph always returns absolute) while comparing
against `ctx.allFiles` (engine's relative paths) — would have made the rule
false-positive on every authorization-marked file in real usage. Both
fixed; full RCA in `docs/qa-intel/RULESET_LESSONS_LEDGER.md`'s 2026-09-06
entry. Also found and fixed: the new rule tests (and the pre-existing
`wave9-new-rules.test.ts`) were **never actually executed** by
`pnpm --filter web vitest run` — `web/vitest.config.ts`'s include glob
didn't cover root-level `scripts/`. Fixed the glob; that surfaced one
pre-existing always-broken test (fixture comment literally contained the
word its own assertion checked was absent) — fixed as a one-liner.

**Lesson explicitly requested and delivered**: 5 candidate qa-intel rules
distilled from this review cycle. 2 implemented as real AST rules
(`SecurityFixWithoutTestRule`, `NonNullAfterArraySortFilterRule`, in
`scripts/quality-engine/rules/security-lessons-20260905.ts`, PR #287). 3
explicitly NOT implemented as qa-intel rules (need non-TS-file support the
ts-morph engine doesn't have, or are inherently diff/history-aware in a way
a single-snapshot AST rule can't express) — documented, not silently
dropped, in the same file's header comments and the ledger.

## 5. Skill SSOT unification across Claude Code, AGY (Gemini/Antigravity), and OC (opencode)

User's core ask: all three agents (plus whichever future ones) should have
**equal access to the full skill set**, so routing which agent/model runs a
task is a free choice based on fit, not an accident of what's installed
where. Findings and fixes, in order:

- **`~/.claude/skills/` is the real SSOT** (59 entries). A documented
  symlink architecture already existed (`hex-yt-intel-agy-skills-management`
  skill) but was never fully executed — confirmed **53 of 57** of AGY's
  `~/.gemini/skills/*` were real independent drifted copies, not symlinks.
  Diffed a sample first (per user's explicit "option 2" instruction) —
  found everything either byte-identical or simply stale, nothing worth
  preserving — then converted all 53 to symlinks. Also fixed one already-
  broken symlink (`database-architect-10x` pointed at a name that no longer
  exists; SSOT had been renamed to `db-arch-10x`), retired a stale generic
  `quality-intelligence` fork in favor of symlinking to `qa-intel`, and
  pulled a genuinely new AGY-only skill (`skill-creator`) into the SSOT.
- **OC (opencode) uses a different file-naming convention**: `<skill-dir>/
  <skill-name>.md`, not `SKILL.md`. Fixed by adding a one-time compat
  symlink *inside every SSOT skill folder* (`<name>.md -> SKILL.md`) —
  makes every SSOT skill readable by both conventions simultaneously, no
  per-agent copies needed. **Live-verified working** via
  `~/.opencode/bin/opencode debug skill` (found at `~/.opencode/bin/`, not
  on PATH) — confirmed `improve-prompt` and `impeccable` both resolve
  through the full symlink chain with correct content. (First check
  falsely showed "not found" — that was output-capture truncation at
  53.7KB, not a real failure; redirecting the command's own stdout to a
  file and grepping that gave the true, complete result.)
- **`impeccable` design skill**: found its real upstream
  (`github.com/pbakaus/impeccable`, tag series `skill-v*`), discovered both
  local copies (SSOT was actually v4.0.1, AGY's `impeccable_direct` fork
  was v3.5.0 — corrected an earlier statement to the user that had this
  backwards) were behind the true upstream latest, **v4.2.2**. Upstream had
  undergone a real architecture migration (JS scripts → self-downloading
  compiled-binary launcher) — not a simple content bump, so did a clean
  wholesale directory replacement rather than a risky line-by-line merge
  (justified because neither local fork had any repo-specific
  customization). Retired the divergent `impeccable_direct` fork entirely.
  Old versions preserved at `~/.claude/skills-backup/` (moved out of the
  live skill tree so they stop appearing in the skill listing — this was
  itself a bug I caused and fixed: `.bak` folders left inside
  `~/.claude/skills/` show up as installed skills).
- **Recurring upstream check**: `~/.claude/skill-maintenance/
  check-impeccable-upstream.sh`, installed as a **real crontab entry**
  (Sundays 03:17, weekly) — flags a version gap in a log file, does NOT
  auto-pull (last update changed the invocation engine; a future one might
  too, and that needs a human decision each time). Explicitly did NOT use
  the in-session `CronCreate` tool for this — those jobs are session-only
  (gone when the CLI session ends) and auto-expire after 7 days regardless,
  which would have silently stopped working and misled the user into
  thinking there was a standing job when there wasn't.
- Cleaned two junk archive files (`skills.zip`, `skills.rar`) that were
  sitting directly inside the SSOT directory.

**Current parity state**: SSOT 59 skills, AGY 55 symlinks + 1 correctly-real
AGY-only glue skill (`antigravity-support`), OC live-confirmed reading 84
total skills (SSOT-symlinked + its own + project-local Claude skills it
also discovers). Zero known drift remaining.

## 6. New `/improve-prompt` skill

Built at the user's explicit request: a global (`~/.claude/skills/
improve-prompt/SKILL.md`, symlinked to AGY/OC) 10-item checklist that
upgrades any prompt — user-to-Claude, Claude-to-subagent, or a draft being
reviewed — to the standard this session settled on. Deliberately dense/
LLM-first per explicit instruction (imperative checklist, not a human
essay), distilled from `docs/agent-prompts/TEMPLATE.md`'s real incident
history. Auto-invocation is description-matching (Claude Code doesn't
force-inject skills into every message) — wired a hard trigger into
TEMPLATE.md itself ("before dispatching, run `improve-prompt`") as the
practical mechanism, same pattern that makes `qa-intel` "always run" today.

**Kept in sync twice already** (both times same-session): once when
`TEMPLATE.md` gained the Model-tuning-rule restoration, again when
TEMPLATE.md gained the two rules in §7 below. Any future TEMPLATE.md change
should re-check this file — it says so in its own "Source" section.

## 7. Real regression I caused and fixed: TEMPLATE.md content loss

Earlier in this session, fixing TEMPLATE.md's 14-fabricated-skill-name
problem via a full-file `Write` (instead of a scoped `Edit`) silently
**deleted** two pieces of unrelated, hard-won content that predated that
fix: the "Model-tuning rule" section (flash-tier models need literal
steps, not prose — from a real 2026-08-07 incident) and the ledger-protocol
incident citation (two agents colliding on one checkout, 2026-08-03).
Caught only because the user asked for an end-to-end template review before
building `/improve-prompt` on top of it. Restored both verbatim via
targeted `git show <old-commit>:TEMPLATE.md` diffing to confirm nothing
else was lost. **Lesson applied going forward this session**: every
subsequent TEMPLATE.md edit used scoped `Edit` calls, never another
full-file `Write`.

## 8. Two new standing rules baked into TEMPLATE.md + CLAUDE.md (this session's last substantive change)

Per direct user feedback, distinguishing CORE (fixed, never changes) from
SELECT (file-triggered, and now explicitly **continuous**):

1. **SELECT re-scoping**: the file-triggered skill decision tree must be
   re-run every time the touched-file set grows beyond what it was at the
   last check — not decided once at dispatch. A task starting in
   `web/components/**` can legitimately end up touching
   `supabase/migrations/**`; the skill selection has to follow the work.
   Each re-check gets logged in the final report with what triggered it.
2. **Model/task-fit routing table**, added to CLAUDE.md's Agent roster
   (not duplicated in TEMPLATE.md, which just points to it): UI/grunt-level
   work → Flash-tier models (observed to excel there); multi-hop/long-
   horizon work → away from Flash tiers (observed weakness regardless of
   provider); narrow well-scoped fixes → cheapest capable option.
   Deliberately NOT an automated benchmarking system, per the user's own
   explicit caution against overcomplicating this — the table carries a
   dated decay warning and points at `.memory/AGENT_LEDGER.md`'s real
   dispatch history as the freshness check instead of new infrastructure.

Both synced into `improve-prompt` immediately (see §6).

## 9. Files/branches map for whoever resumes

| What | Where |
|---|---|
| Security fix PR | `fix/security-idor-and-entitlements-bypass` → PR #286 (open) |
| qa-intel rules PR | `chore/qa-intel-security-lessons-rules` → PR #287 (open) |
| First-pass audit | `docs/AUDIT_REPORT_2026-09-05.md` + `_part{1..4}` |
| 10x re-audit | `docs/AUDIT_2026-09-05_10x_MASTER.md` + `_lane{A..E}` |
| qa-intel lessons | `docs/qa-intel/RULESET_LESSONS_LEDGER.md` (2 new 2026-09 entries) |
| Dispatch template | `docs/agent-prompts/TEMPLATE.md` |
| Agent roster + routing | `CLAUDE.md` §"Agent roster" |
| New global skill | `~/.claude/skills/improve-prompt/` |
| Impeccable backups | `~/.claude/skills-backup/impeccable.pre-4.2.2/`, `impeccable_direct.pre-unify/` |
| Upstream-check cron | `~/.claude/skill-maintenance/check-impeccable-upstream.sh`, weekly Sun 03:17 |

## 10. Immediate next steps, priority order

1. Merge PR #286, merge PR #287.
2. Redeploy Vercel production; apply
   `20260905120000_fix_temporal_subgraph_idor.sql` to production DB (only
   validated against a branch preview so far — verify the installed
   migration version matches per ADR 018's protocol).
3. Run post-deploy smoke tests named in PR #286 (founder account still
   works; substring-match email does not; cross-tenant `get_temporal_
   subgraph` call is rejected; service-role call still works).
4. Fresh audit pass on `docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` (17+ days
   stale, doesn't account for the ADR 026 KG/taxonomy chain).
5. Independently verify `LLMCascade.ts` §1e.1's SSOT bypass claim.
6. Decide on the Paddle webhook TOCTOU (High severity, found but not yet
   fixed) and the PR Confidence Calculator's broken scoring weights.
7. Optional cleanup: ~25+ stale `.claude/worktrees/agent-*` dirs;
   `skill-creator`'s description still says "Gemini CLI" (cosmetic).
