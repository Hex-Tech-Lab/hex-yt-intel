# Agent Dispatch Prompt — phase-c clickable timestamps (Task 3 of 5)

**Target Agent**: OC
**Effort Level**: low

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

## 1. Context & Problem Statement

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c` (PR #442), HEAD clean. Requirement: raw timestamps (`01:23`, `1:23:45`) in dimension outputs must be interactive `<button>` elements, styled via centralized CSS (no inline style objects), that seek the global video player.

EXISTING infrastructure (CC-verified — reuse it, do NOT build a parallel one):
- web/lib/utils/format.tsx: `preprocessMarkdown()` → `linkifyTimestamps()` (line ~207) already rewrites timestamps to `[⏱ 1:23](#t=83)`, skipping code fences, inline code, existing links, ISO dates, invalid mm/ss.
- web/components/markdown/dimensionMarkdownComponents.tsx: shared react-markdown `a` override routing `#t=` hrefs to a seek.
- Users of preprocessMarkdown: dashboard/SelectedDimensionReadout.tsx, console/ChatDock.tsx (own `#t=` handler at ~127 — duplicate of the shared one), console/ApexSummaryCard.tsx, app/admin/parity-review/ParityReviewClient.tsx.
- Player: console/VideoPlayerCard.tsx already queues seeks until onReady (seekQueueRef, ~line 128). Port: web/lib/ports/VideoPlayerPort.ts.

## 2. Directives (in order, literally)
1. Step 0: code-review-graph — find EVERY component that renders dimension content markdown (`query_graph_tool` / `semantic_search_nodes_tool` for ReactMarkdown/Markdown usages and `dimension.content`). List each and whether it (a) runs preprocessMarkdown and (b) uses the shared `#t=` override. This list is the RCA.
2. Fix the gaps from step 1 by wiring the missing views to preprocessMarkdown + dimensionMarkdownComponents. No new regex, no second linkifier.
3. In dimensionMarkdownComponents.tsx, render `#t=` links as `<button type="button">` with an aria-label like "Seek to 1:23", using ONE shared class defined in the existing global stylesheet (find where web/ global CSS lives; Tailwind @apply or plain CSS). Keep normal links as `<a>`.
4. Replace ChatDock's duplicate `#t=` handler with the shared override ONLY if it is a drop-in; otherwise report it as a tangent.
5. Tests: a component test (happy-dom + RTL, like existing web component tests) rendering dimension markdown containing `see 1:23 and 1:02:03`, asserting two buttons and that clicking calls seek with 83 and 3723. Negative control: revert the step-3 button change → test fails.
6. Scope: the files above + one global CSS file + tests. No layout/panel work (that's Task 4).

## 4a. Gates (paste tails)
```bash
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @hex-yt-intel/web exec tsc --noEmit
cd web && pnpm exec vitest run components lib/utils
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --mode diff
```
Commit on `phase-c`: `feat(web): clickable timestamp buttons in all dimension views`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

## 5. The 4 Development Tenets — Universal Executor DNA — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

Source: `docs/agent-prompts/UNIVERSAL_EXECUTOR_DNA.md` (keep both identical).

> ### THE 4 DEVELOPMENT TENETS (YOUR MANDATORY DNA)
> You are a 10X Executor Agent. You must rigidly adhere to these laws during this task:
> 1. **End-to-End (E2E) Workflow Traversal:** Never fix an isolated "site error." Trace the payload path backward to the input and forward to the database or DOM. Ensure no breaks exist across the timeline.
> 2. **Contract Definition & Enforcement:** Mismatched schemas across boundaries are fatal. Rigorously enforce typing, handle edge cases, and respect cryptographic provenance.
> 3. **Hunt Breakages & Tangents (WITHIN SCOPE ONLY):** While walking your E2E path, actively hunt for blind spots. **The Dispatch Prompt explicitly defines your scope.** If you find an issue outside this defined scope, DO NOT fix it. Report it and request clarification. Emergency out-of-scope fixes are strictly prohibited unless explicitly authorized by the Master Orchestrator (GCW) in the dispatch.
> 4. **Mandatory Skill Execution:** You MUST run your local verification skills. Do not return your report until you have executed `/refactor-safely` for AST mutations, and validated your work with `qa-intel`, local linters, and test suites.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
