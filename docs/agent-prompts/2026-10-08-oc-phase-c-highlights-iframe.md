# Agent Dispatch Prompt — phase-c Highlights polling + YouTube iframe (Task 2 of 5)

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

Worktree /home/kellyb_dev/projects/hex-yt-intel-wt-10x, branch `phase-c` (PR #442). Investigate before fixing — the root cause is NOT pre-derived.

User-reported symptoms (browser DevTools):
A. `/api/analyses/highlights` — rapid-fire CANCELLED requests in the Network tab, and sometimes a silent hang (rail never fills).
B. YouTube iframe console error: "Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://www.youtube.com') does not match the recipient window's origin".

Known facts (CC-verified):
- Client hook: web/lib/hooks/useHighlightsStatus.ts — useEffect deps `[analysisId, status, digestLoading]` (line ~128); each run creates an AbortController and aborts on cleanup (line ~125); retry loop with getHighlightsRetryDelayMs.
- Dedupe helper: web/lib/utils/dedupe-fetch.ts. Consumer: web/components/dashboard/HighlightsScrubber.tsx. Route: web/app/api/analyses/highlights/route.ts (+ __tests__/route.test.ts).
- YouTube: web/lib/adapters/YouTubePlayerAdapter.ts ALREADY sets `playerVars.origin = window.location.origin` (line ~138). So "add origin" is done — find the real remaining cause (e.g. `host` option, player created before iframe src origin settles, a second player/iframe created elsewhere, or a hot re-mount). If the warning is the benign, unfixable YouTube-side one, say so with evidence; do not invent a fix.

## 2. Directives (in order, literally)
1. Step 0: use code-review-graph (`query_graph_tool` callers_of useHighlightsStatus, YouTubePlayerAdapter) before reading files.
2. A: determine WHICH dep change causes each abort/re-run (likely status/digestLoading flipping during streaming). Fix so one analysisId gets at most one in-flight request and a settled result is never refetched just because an unrelated flag flipped; a terminal "not ready / failed" must surface (no silent hang). Check the route for any path that never responds.
3. A test: add a hook test proving flag flips during polling do not abort+restart the fetch (render the hook with happy-dom/RTL like existing web hook tests). Negative control: revert fix → test fails.
4. B: report root cause with evidence; fix only if real and in YouTubePlayerAdapter.ts.
5. Scope: only the files named above + their tests. Out-of-scope issues → report, don't fix.

## 4a. Gates (paste tails)
```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
cd web && pnpm exec vitest run lib/hooks app/api/analyses/highlights lib/utils lib/adapters
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --mode diff
```
Commit on `phase-c`: `fix(web): stop highlights polling abort loop` (+ iframe if fixed), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

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
