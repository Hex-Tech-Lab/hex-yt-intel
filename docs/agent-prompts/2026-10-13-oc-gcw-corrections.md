# Agent Dispatch Prompt — GCW corrections (THOS fix, 50s deadline test, ADR-043 gates, #486 migration fix)

**Target Agent**: Haiku supervisor (CC). OC dropped by owner directive 2026-10-13; no opencode runs.
**Effort Level**: low
**Branch**: `fix/gcw-corrections` (worktree `~/projects/hex-yt-intel-wt-gcw`, from `origin/uat`). PR base: `uat`.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## 1. Tasks

1. **THOS fix** — `docs/history/THOS_2026-10-12_UAT_WAVE.md`: verified merge state (#467–#485 on `main`, #486–#495 on `uat` only); PR 494 does not prevent double paid classification; OC model line per CLAUDE.md standard; SHA placeholders for owner; STREAM_HMAC_SECRET as an open pre-go-live gate (not done, not a uat blocker).
2. **Default 50s deadline test** — `worker/src/__tests__/chat-cascade-deadline.test.ts`: parameterized (omitted / explicit undefined), fake timers, not aborted at 49_999 ms, aborted at 50_000 ms. Negative control: default 60_000 must fail.
3. **ADR-043 edits** — on PR #497's branch (`docs/adr-043-chat-intent-prompt-guard`), not uat: rollout gates, Preview status for both Prompt Guard models, untracked brief citation removed.
4. **#486 migration bug** — new migration `supabase/migrations/20261013100000_fix_get_temporal_subgraph_ambiguous_columns.sql` qualifies `subgraph.anchor_id` / `subgraph.depth`. Do not apply to any DB. Do not edit `20261012180000_fix_db_security_advisors.sql`. Guard test asserts the qualified SQL.

## 2. Steps (mechanical, in order)

1. Build the graph for the worktree (`build_or_update_graph_tool`). Code lookups: code-review-graph MCP only, no grep.
2. Run `pnpm qa-intel:ci`, `pnpm exec tsc --noEmit` (web and worker typecheck config), `pnpm lint` (web), and `pnpm exec vitest run` on the touched test files (from `web/`, with `../worker/src/...` paths).
3. Negative controls: revert the fix and show each new test fails; restore.
4. Commit, write `$(git rev-parse --git-dir)/skill-gates-ok` (line 1 = HEAD, then one honest line per gate), then STOP and report READY FOR CC REVIEW with branch and HEAD.

## 3. Tenets

> ### THE 4 DEVELOPMENT TENETS (YOUR MANDATORY DNA)
> You are a 10X Executor Agent. You must rigidly adhere to these laws during this task:
> 1. **End-to-End (E2E) Workflow Traversal:** Never fix an isolated "site error." Trace the payload path backward to the input and forward to the database or DOM. Ensure no breaks exist across the timeline.
> 2. **Contract Definition & Enforcement:** Mismatched schemas across boundaries are fatal. Rigorously enforce typing, handle edge cases, and respect cryptographic provenance.
> 3. **Hunt Breakages & Tangents (WITHIN SCOPE ONLY):** While walking your E2E path, actively hunt for blind spots. **The Dispatch Prompt explicitly defines your scope.** If you find an issue outside this defined scope, DO NOT fix it. Report it and request clarification. Emergency out-of-scope fixes are strictly prohibited unless explicitly authorized by the Master Orchestrator (GCW) in the dispatch.
> 4. **Mandatory Skill Execution:** You MUST run your local verification skills. Do not return your report until you have executed `/refactor-safely` for AST mutations, and validated your work with `qa-intel`, local linters, and test suites.

## 4. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
