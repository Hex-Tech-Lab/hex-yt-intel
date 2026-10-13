# Agent Dispatch Prompt — T5 Highlights Reel

**Target Agent**: AGY (Gemini 3.8 Flash, low)
**Effort Level**: low

**Worktree**: `/home/kellyb_dev/projects/hex-yt-intel-wt-t5-reel` (branch `fix/highlights-reel-t5`, from `origin/uat`). Work ONLY in this worktree. Do NOT touch `~/projects/hex-yt-intel-wt-ux-motion` or any other worktree. PR base is `uat`, never `main`.

---

## Code-lookup rule — [OWNER DIRECTIVE, 2026-10-13]

**Do NOT use grep, rg, or find for code lookups.** Use the code-review-graph MCP tools for every lookup: `mcp__code-review-graph__semantic_search_nodes_tool` to find symbols, `mcp__code-review-graph__query_graph_tool` (callers_of, callees_of, file_summary, tests_for) to trace relationships, and `mcp__code-review-graph__get_impact_radius_tool` to check blast radius before editing. Pass `repo_root` = the worktree path above. The graph is already built for this worktree at HEAD 8ee93799. Read a file only after the graph has pointed you at it. If a graph tool errors or returns nothing, write that down in your report and stop. Do not fall back to grep.

---

## 1. Context & Problem Statement

The highlights reel is a video-synced playlist of analysis highlights. Two UAT-reported defects, plus a read-only investigation.

Starting points from the graph (verify with it):
- `web/components/dashboard/HighlightsTrack.tsx` (HighlightsNav, handlePrev)
- `web/components/dashboard/HighlightsScrubber.tsx`
- `web/components/dashboard/HighlightsTrackView.tsx`
- `web/lib/adapters/YouTubePlayerAdapter.ts::YouTubePlayerAdapter.seekTo` (line 189)
- `web/app/share/[token]/PublicHighlightsReel.tsx` (public share view, may share logic)

Defects:
- **(a)** Switching the reel from Simple to Pro mode loses the reel play position. Playback should resume at the same point in the reel after the switch.
- **(b)** Play or seek on the reel scrolls the page. It must not.

Part (c) is investigation only.

---

## 2. Contract & Implementation Directives (literal numbered steps)

1. Use the graph to locate the Simple/Pro switch and the reel's play and seek handlers (`semantic_search_nodes_tool`, then `callers_of` / `callees_of`). Record the file:line of each.
2. Fix **(a)**: keep the reel play position across the Simple to Pro switch and resume playback there. Find what unmounts or resets the position (state, ref, or player re-init) and preserve it. Minimal change only.
3. Fix **(b)**: stop play and seek on the reel from scrolling the page. Trace the seek path through the graph and find any scroll side effect (scrollIntoView, focus on a non-visible target, window scroll). Remove or contain it. Do not change scroll behaviour of unrelated sections.
4. Add or update a unit test for each fix. Show a negative control: each test must fail without your fix.
5. Run `get_impact_radius_tool` on your changed files and report the blast radius.
6. Run the gates in §4 below. Fix anything they report in the files you touched.
7. **(c) Report only, no code change**: explain how highlights are selected today (the function, its inputs, its cap or threshold), and why it misses key revelations in dense talks. Cite file:line. Do not edit anything for (c).
8. Commit to `fix/highlights-reel-t5`. Do not push to `main`. Write the PR body to a file, then run `gh pr create --base uat --body-file <file>`. Never put PR text inside a shell command string.

Scope is exactly (a), (b), and the (c) report. Anything else found is a tangent: report it, do not fix it. Stack: pnpm only. Tailwind and Astryx only. No shadcn.

---

## 3. Pre-PR Review Skills

- Touched `web/components/**` or `web/hooks/**`: run `react-best-practices` and `web-design-guidelines`. Record each as run, with findings.
- Always: `/simplify` on your diff, applying what it applies. `/refactor-safely` for any AST mutation.

---

## 4. Gates (run all, paste real output)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```

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
